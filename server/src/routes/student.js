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
      'SELECT role, content_enc, kind FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
    ),
    insertMessage: db.prepare('INSERT INTO messages (conversation_id, role, content_enc, kind) VALUES (?, ?, ?, ?)'),
    setMessageKind: db.prepare('UPDATE messages SET kind = ? WHERE id = ?'),
    setPromptFlag: db.prepare('UPDATE prompt_logs SET flag = ? WHERE id = ?'),
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

  router.post('/conversations', async (req, res) => {
    const subject = q.subject.get(Number(req.body.subjectId));
    if (!subject || !hasAccess(req.user.id, subject.id)) {
      return res.status(403).json({ error: 'You do not have access to this teacher.' });
    }
    const id = db
      .prepare('INSERT INTO conversations (student_id, subject_id) VALUES (?, ?)')
      .run(req.user.id, subject.id).lastInsertRowid;
    try {
      const greeting = (
        await llm.complete(
          [
            { role: 'system', content: prompts.buildGreetingPrompt(subject, req.user.display_name) },
            { role: 'user', content: 'Please greet me and start the chat.' },
          ],
          { maxTokens: 300, temperature: 0.3 }
        )
      ).trim();
      if (greeting) q.insertMessage.run(id, 'assistant', encrypt(greeting), 'greeting');
    } catch (err) {
      console.error('[chat] greeting failed:', err.message);
    }
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
    const history = prompts
      .selectHistory(
        q.recentMessages
          .all(conv.id, config.historyMessages * 3)
          .reverse()
          .map((m) => ({ role: m.role, kind: m.kind, content: decrypt(m.content_enc) }))
      )
      .slice(-config.historyMessages)
      .map(({ role, content }) => ({ role, content }));
    let flag = null;
    let kind = 'chat';
    if (guards.detectWellbeingConcern(content)) {
      flag = 'wellbeing';
      kind = 'wellbeing';
    }

    const logId = q.logPrompt.run(req.user.id, subject.id, subject.name, conv.id, encrypt(content), flag).lastInsertRowid;
    const userMessageId = q.insertMessage.run(conv.id, 'user', encrypt(content), 'chat').lastInsertRowid;
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

    const unavailable =
      'The AI tutor is not available right now (the language model could not be reached). Your message was saved. Please try again in a moment or let your teacher know.';

    try {
      const triagePrompt = prompts.buildTriagePrompt({
        subject,
        restrictions,
        subjects: allSubjects,
        allowedSubjectIds: repo.studentSubjectIds(db, req.user.id),
      });
      const triage = prompts.parseTriage(
        await llm.complete(
          [
            { role: 'system', content: triagePrompt },
            { role: 'user', content },
          ],
          { maxTokens: 400, temperature: 0, signal: abort.signal }
        )
      );
      if (triage.decision === 'restricted' || triage.decision === 'redirect') {
        let message = triage.message;
        if (!message) {
          const more = (
            await llm.complete(
              [
                { role: 'system', content: triagePrompt },
                {
                  role: 'user',
                  content: `${content}\n\nYour decision is ${triage.decision}. Write only the message the student should see.`,
                },
              ],
              { maxTokens: 400, temperature: 0.3, signal: abort.signal }
            )
          ).trim();
          const parsed = prompts.parseTriage(more);
          message = parsed.message || (/decision\s*:/i.test(more) ? '' : more);
        }
        if (!message) {
          send({ type: 'error', message: unavailable });
          return res.end();
        }
        kind = triage.decision;
        if (triage.decision === 'restricted') {
          q.setMessageKind.run('restricted', userMessageId);
          q.setPromptFlag.run('restricted', logId);
        }
        send({ type: 'token', text: message });
        return finish(message, kind);
      }

      const system = prompts.buildSystemPrompt({
        subject,
        goals: repo.activeGoals(db),
        restrictions,
        studentName: req.user.display_name,
        frustrated: guards.detectFrustration(content),
      });
      const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content }];

      const answer = await llm.streamChat(messages, {
        signal: abort.signal,
        onToken: (t) => send({ type: 'token', text: t }),
      });
      if (abort.signal.aborted) return;
      if (!answer) {
        send({ type: 'error', message: unavailable });
        return res.end();
      }
      finish(answer, kind);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[chat] generation failed:', err.message);
      send({ type: 'error', message: unavailable });
      res.end();
    }
  });

  return router;
};
