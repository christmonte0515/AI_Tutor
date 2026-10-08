const express = require('express');
const config = require('../config');
const llm = require('../llm');
const repo = require('../repo');
const guards = require('../guards');
const prompts = require('../prompt');
const { encrypt, decrypt } = require('../security');
const { requireAuth } = require('../auth');

function titleFrom(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}

module.exports = function studentRoutes(db) {
  const router = express.Router();
  router.use(requireAuth(db, 'student'));

  const q = {
    subject: db.prepare(
      `SELECT s.id, s.name, s.teacher_name, s.description, s.keywords, s.icon, s.domain_id, d.name AS domain_name
       FROM subjects s JOIN domains d ON d.id = s.domain_id WHERE s.id = ?`
    ),
    hasAccess: db.prepare('SELECT 1 FROM student_subjects WHERE student_id = ? AND subject_id = ?'),
    conversation: db.prepare('SELECT * FROM conversations WHERE id = ? AND student_id = ?'),
    messages: db.prepare('SELECT id, role, content_enc, kind, created_at FROM messages WHERE conversation_id = ? ORDER BY id'),
    recentMessages: db.prepare(
      'SELECT role, content_enc FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
    ),
    insertMessage: db.prepare('INSERT INTO messages (conversation_id, role, content_enc, kind) VALUES (?, ?, ?, ?)'),
    touch: db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"),
    setTitle: db.prepare('UPDATE conversations SET title_enc = ? WHERE id = ? AND title_enc IS NULL'),
    logPrompt: db.prepare(
      'INSERT INTO prompt_logs (student_id, subject_id, subject_name, conversation_id, content_enc, flag) VALUES (?, ?, ?, ?, ?, ?)'
    ),
  };

  const hasAccess = (studentId, subjectId) => !!q.hasAccess.get(studentId, subjectId);

  router.get('/subjects', (req, res) => {
    const allowed = new Set(repo.studentSubjectIds(db, req.user.id));
    const domains = repo
      .catalog(db)
      .map((d) => ({
        id: d.id,
        name: d.name,
        subjects: d.subjects
          .filter((s) => allowed.has(s.id))
          .map(({ id, name, teacherName, description, icon }) => ({ id, name, teacherName, description, icon })),
      }))
      .filter((d) => d.subjects.length);
    res.json({ domains });
  });

  router.get('/conversations', (req, res) => {
    const allowed = new Set(repo.studentSubjectIds(db, req.user.id));
    const rows = db
      .prepare(
        `SELECT c.id, c.subject_id, c.title_enc, c.created_at, c.updated_at, s.name AS subject_name, s.teacher_name, s.icon
         FROM conversations c JOIN subjects s ON s.id = c.subject_id
         WHERE c.student_id = ? ORDER BY c.updated_at DESC, c.id DESC`
      )
      .all(req.user.id);
    res.json({
      conversations: rows.map((c) => ({
        id: c.id,
        subjectId: c.subject_id,
        subjectName: c.subject_name,
        teacherName: c.teacher_name,
        icon: c.icon,
        title: decrypt(c.title_enc) || 'New conversation',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        locked: !allowed.has(c.subject_id),
      })),
    });
  });

  router.post('/conversations', (req, res) => {
    const subject = q.subject.get(Number(req.body.subjectId));
    if (!subject || !hasAccess(req.user.id, subject.id)) {
      return res.status(403).json({ error: 'You do not have access to this teacher.' });
    }
    const id = db
      .prepare('INSERT INTO conversations (student_id, subject_id) VALUES (?, ?)')
      .run(req.user.id, subject.id).lastInsertRowid;
    q.insertMessage.run(id, 'assistant', encrypt(prompts.greeting(subject)), 'greeting');
    res.status(201).json({ id });
  });

  router.get('/conversations/:id', (req, res) => {
    const conv = q.conversation.get(Number(req.params.id), req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    const subject = q.subject.get(conv.subject_id);
    res.json({
      conversation: {
        id: conv.id,
        subjectId: conv.subject_id,
        subjectName: subject?.name,
        teacherName: subject?.teacher_name,
        icon: subject?.icon || '',
        title: decrypt(conv.title_enc) || 'New conversation',
        locked: !hasAccess(req.user.id, conv.subject_id),
      },
      messages: q.messages.all(conv.id).map((m) => ({
        id: m.id,
        role: m.role,
        content: decrypt(m.content_enc),
        kind: m.kind,
        createdAt: m.created_at,
      })),
    });
  });

  router.delete('/conversations/:id', (req, res) => {
    const result = db
      .prepare('DELETE FROM conversations WHERE id = ? AND student_id = ?')
      .run(Number(req.params.id), req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Conversation not found.' });
    res.json({ ok: true });
  });

  // Streams the reply as Server-Sent Events:
  //   {type:"token", text} | {type:"replace", text} | {type:"done", messageId, kind} | {type:"error", message}
  router.post('/conversations/:id/messages', async (req, res) => {
    const conv = q.conversation.get(Number(req.params.id), req.user.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    const subject = q.subject.get(conv.subject_id);
    if (!subject || !hasAccess(req.user.id, subject.id)) {
      return res.status(403).json({ error: 'Your teacher has not given you access to this subject.' });
    }
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Please type a message.' });
    if (content.length > config.maxMessageChars) {
      return res.status(400).json({ error: `Messages can be at most ${config.maxMessageChars} characters.` });
    }

    const restrictions = repo.activeRestrictions(db);
    const allSubjects = repo.subjectsWithDomain(db);
    const history = q.recentMessages
      .all(conv.id, config.historyMessages)
      .reverse()
      .map((m) => ({ role: m.role, content: decrypt(m.content_enc) }));
    const previousReply = [...history].reverse().find((m) => m.role === 'assistant')?.content;

    let flag = null;
    let fixedReply = null;
    let kind = 'chat';
    if (guards.detectWellbeingConcern(content)) {
      flag = 'wellbeing';
      kind = 'wellbeing';
      fixedReply = prompts.wellbeingReply();
    } else if (guards.findQuestionRestriction(content, restrictions)) {
      flag = 'restricted';
      kind = 'restricted';
      fixedReply = prompts.restrictedQuestionReply();
    }

    q.logPrompt.run(req.user.id, subject.id, subject.name, conv.id, encrypt(content), flag);
    q.insertMessage.run(conv.id, 'user', encrypt(content), 'chat');
    q.setTitle.run(encrypt(titleFrom(content)), conv.id);
    q.touch.run(conv.id);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const finish = (text, messageKind) => {
      const id = q.insertMessage.run(conv.id, 'assistant', encrypt(text), messageKind).lastInsertRowid;
      q.touch.run(conv.id);
      send({ type: 'done', messageId: id, kind: messageKind });
      res.end();
    };

    try {
      if (!fixedReply) {
        const scope = await guards.checkScope(content, subject, allSubjects, {
          mode: config.scopeCheck,
          previousReply,
        });
        if (scope.decision === 'out_of_scope') {
          kind = 'redirect';
          fixedReply = prompts.outOfScopeReply(subject, scope.subject, hasAccess(req.user.id, scope.subject.id));
        }
      }

      if (fixedReply) {
        send({ type: 'token', text: fixedReply });
        return finish(fixedReply, kind);
      }

      const system = prompts.buildSystemPrompt({
        subject,
        goals: repo.activeGoals(db),
        restrictions,
        otherSubjects: allSubjects.filter((s) => s.id !== subject.id).map((s) => s.name),
        studentName: req.user.display_name,
        frustrated: guards.detectFrustration(content),
      });
      const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content }];

      let visible = '';
      let violation = null;
      const answer = await llm
        .streamChat(messages, {
          signal: abort.signal,
          onToken: (t) => {
            if (violation) return;
            visible += t;
            violation = guards.findResponseViolation(visible, restrictions);
            if (violation) abort.abort();
            else send({ type: 'token', text: t });
          },
        })
        .catch((err) => {
          if (violation) return null;
          throw err;
        });

      if (violation) {
        const safe = prompts.restrictedResponseReply();
        send({ type: 'replace', text: safe });
        return finish(safe, 'filtered');
      }
      if (abort.signal.aborted) return;
      finish(answer || "I'm sorry, I couldn't come up with an answer. Could you rephrase the question?", 'chat');
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[chat] generation failed:', err.message);
      send({
        type: 'error',
        message:
          'The AI tutor is not available right now (the language model could not be reached). Your message was saved. Please try again in a moment or let your teacher know.',
      });
      res.end();
    }
  });

  return router;
};
