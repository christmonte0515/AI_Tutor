const express = require('express');
const config = require('../config');
const llm = require('../llm');
const icons = require('../icons');
const repo = require('../repo');
const { transaction } = require('../db');
const { decrypt, hashPassword } = require('../security');
const { requireAuth } = require('../auth');

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function ids(value) {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter(Number.isInteger))] : [];
}

function notFound(res, what) {
  return res.status(404).json({ error: `${what} not found.` });
}

module.exports = function adminRoutes(db) {
  const router = express.Router();
  router.use(requireAuth(db, 'admin'));

  // ---- Status -------------------------------------------------------------
  router.get('/status', async (req, res) => {
    res.json({ model: config.ollama.model, ollamaUrl: config.ollama.baseUrl, ollama: await llm.health() });
  });

  // ---- Students & access --------------------------------------------------
  router.get('/students', (req, res) => {
    const students = db
      .prepare(
        `SELECT id, email, display_name, active, created_at, last_login_at
         FROM users WHERE role = 'student' ORDER BY display_name COLLATE NOCASE, email`
      )
      .all();
    const links = db.prepare('SELECT student_id, subject_id FROM student_subjects').all();
    res.json({
      students: students.map((s) => ({
        id: s.id,
        email: s.email,
        displayName: s.display_name,
        active: !!s.active,
        createdAt: s.created_at,
        lastLoginAt: s.last_login_at,
        subjectIds: links.filter((l) => l.student_id === s.id).map((l) => l.subject_id),
      })),
    });
  });

  router.put('/students/:id/subjects', (req, res) => {
    const studentId = Number(req.params.id);
    if (!db.prepare("SELECT id FROM users WHERE id = ? AND role = 'student'").get(studentId)) {
      return notFound(res, 'Student');
    }
    const subjectIds = ids(req.body.subjectIds);
    transaction(db, () => {
      db.prepare('DELETE FROM student_subjects WHERE student_id = ?').run(studentId);
      const ins = db.prepare(
        'INSERT INTO student_subjects (student_id, subject_id) SELECT ?, id FROM subjects WHERE id = ?'
      );
      for (const sid of subjectIds) ins.run(studentId, sid);
    });
    res.json({ subjectIds: repo.studentSubjectIds(db, studentId) });
  });

  router.post('/students/bulk-subjects', (req, res) => {
    const studentIds = ids(req.body.studentIds);
    const subjectIds = ids(req.body.subjectIds);
    const mode = req.body.mode === 'remove' ? 'remove' : 'add';
    const stmt =
      mode === 'add'
        ? db.prepare(
            `INSERT OR IGNORE INTO student_subjects (student_id, subject_id)
             SELECT u.id, s.id FROM users u, subjects s WHERE u.id = ? AND u.role = 'student' AND s.id = ?`
          )
        : db.prepare('DELETE FROM student_subjects WHERE student_id = ? AND subject_id = ?');
    let changes = 0;
    transaction(db, () => {
      for (const st of studentIds) for (const su of subjectIds) changes += stmt.run(st, su).changes;
    });
    res.json({ changes });
  });

  router.patch('/students/:id', (req, res) => {
    const studentId = Number(req.params.id);
    const result = db
      .prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'student'")
      .run(req.body.active ? 1 : 0, studentId);
    if (!result.changes) return notFound(res, 'Student');
    res.json({ ok: true });
  });

  router.delete('/students/:id', (req, res) => {
    const result = db.prepare("DELETE FROM users WHERE id = ? AND role = 'student'").run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Student');
    res.json({ ok: true });
  });

  // ---- Domains & subjects -------------------------------------------------
  router.get('/catalog', (req, res) => res.json({ domains: repo.catalog(db) }));

  router.post('/domains', (req, res) => {
    const name = text(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'Domain name is required.' });
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM domains').get().n;
    const id = db.prepare('INSERT INTO domains (name, sort_order) VALUES (?, ?)').run(name, order).lastInsertRowid;
    res.status(201).json({ id });
  });

  router.patch('/domains/:id', (req, res) => {
    const name = text(req.body.name, 100);
    if (!name) return res.status(400).json({ error: 'Domain name is required.' });
    const result = db.prepare('UPDATE domains SET name = ? WHERE id = ?').run(name, Number(req.params.id));
    if (!result.changes) return notFound(res, 'Domain');
    res.json({ ok: true });
  });

  router.delete('/domains/:id', (req, res) => {
    const result = db.prepare('DELETE FROM domains WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Domain');
    res.json({ ok: true });
  });

  function subjectFields(body) {
    const name = text(body.name, 100);
    return {
      domainId: Number(body.domainId),
      name,
      teacherName: text(body.teacherName, 100) || `${name} Tutor`,
      description: text(body.description, 1000),
      keywords: text(body.keywords, 2000),
      icon: text(body.icon, 100).toLowerCase(),
    };
  }

  router.post('/subjects', (req, res) => {
    const f = subjectFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Subject name is required.' });
    if (f.icon && !icons.exists(f.icon)) return res.status(400).json({ error: `Unknown logo "${f.icon}".` });
    if (!db.prepare('SELECT id FROM domains WHERE id = ?').get(f.domainId)) return notFound(res, 'Domain');
    const id = db
      .prepare('INSERT INTO subjects (domain_id, name, teacher_name, description, keywords, icon) VALUES (?, ?, ?, ?, ?, ?)')
      .run(f.domainId, f.name, f.teacherName, f.description, f.keywords, f.icon).lastInsertRowid;
    res.status(201).json({ id });
  });

  router.patch('/subjects/:id', (req, res) => {
    const f = subjectFields(req.body);
    if (!f.name) return res.status(400).json({ error: 'Subject name is required.' });
    if (f.icon && !icons.exists(f.icon)) return res.status(400).json({ error: `Unknown logo "${f.icon}".` });
    if (!db.prepare('SELECT id FROM domains WHERE id = ?').get(f.domainId)) return notFound(res, 'Domain');
    const result = db
      .prepare('UPDATE subjects SET domain_id = ?, name = ?, teacher_name = ?, description = ?, keywords = ?, icon = ? WHERE id = ?')
      .run(f.domainId, f.name, f.teacherName, f.description, f.keywords, f.icon, Number(req.params.id));
    if (!result.changes) return notFound(res, 'Subject');
    res.json({ ok: true });
  });

  router.delete('/subjects/:id', (req, res) => {
    const result = db.prepare('DELETE FROM subjects WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Subject');
    res.json({ ok: true });
  });

  router.get('/icons', (req, res) => res.json({ icons: icons.search(text(req.query.q, 50), 40) }));

  // ---- Content restrictions -----------------------------------------------
  router.get('/restrictions', (req, res) => {
    const rows = db.prepare('SELECT * FROM restrictions ORDER BY kind, id').all();
    res.json({ restrictions: rows.map((r) => ({ ...r, active: !!r.active })) });
  });

  function restrictionFields(body) {
    return {
      kind: body.kind === 'response' ? 'response' : 'question',
      description: text(body.description, 500),
      keywords: text(body.keywords, 2000),
      active: body.active === false ? 0 : 1,
    };
  }

  router.post('/restrictions', (req, res) => {
    const f = restrictionFields(req.body);
    if (!f.description) return res.status(400).json({ error: 'Description is required.' });
    const id = db
      .prepare('INSERT INTO restrictions (kind, description, keywords, active) VALUES (?, ?, ?, ?)')
      .run(f.kind, f.description, f.keywords, f.active).lastInsertRowid;
    res.status(201).json({ id });
  });

  router.patch('/restrictions/:id', (req, res) => {
    const f = restrictionFields(req.body);
    if (!f.description) return res.status(400).json({ error: 'Description is required.' });
    const result = db
      .prepare('UPDATE restrictions SET kind = ?, description = ?, keywords = ?, active = ? WHERE id = ?')
      .run(f.kind, f.description, f.keywords, f.active, Number(req.params.id));
    if (!result.changes) return notFound(res, 'Restriction');
    res.json({ ok: true });
  });

  router.delete('/restrictions/:id', (req, res) => {
    const result = db.prepare('DELETE FROM restrictions WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Restriction');
    res.json({ ok: true });
  });

  // ---- Learning goals -----------------------------------------------------
  router.get('/goals', (req, res) => {
    const rows = db.prepare('SELECT * FROM learning_goals ORDER BY sort_order, id').all();
    res.json({ goals: rows.map((g) => ({ ...g, active: !!g.active })) });
  });

  router.post('/goals', (req, res) => {
    const goal = text(req.body.text, 1000);
    if (!goal) return res.status(400).json({ error: 'Goal text is required.' });
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM learning_goals').get().n;
    const id = db.prepare('INSERT INTO learning_goals (text, sort_order) VALUES (?, ?)').run(goal, order).lastInsertRowid;
    res.status(201).json({ id });
  });

  router.patch('/goals/:id', (req, res) => {
    const goal = text(req.body.text, 1000);
    if (!goal) return res.status(400).json({ error: 'Goal text is required.' });
    const result = db
      .prepare('UPDATE learning_goals SET text = ?, active = ? WHERE id = ?')
      .run(goal, req.body.active === false ? 0 : 1, Number(req.params.id));
    if (!result.changes) return notFound(res, 'Goal');
    res.json({ ok: true });
  });

  router.delete('/goals/:id', (req, res) => {
    const result = db.prepare('DELETE FROM learning_goals WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Goal');
    res.json({ ok: true });
  });

  // ---- Prompt history -----------------------------------------------------
  function promptFilter(query) {
    const where = [];
    const params = [];
    if (query.studentId) {
      where.push('p.student_id = ?');
      params.push(Number(query.studentId));
    }
    if (query.subjectId) {
      where.push('p.subject_id = ?');
      params.push(Number(query.subjectId));
    }
    if (query.flagged === 'true') where.push('p.flag IS NOT NULL');
    if (query.from) {
      where.push('p.created_at >= ?');
      params.push(text(query.from, 30));
    }
    if (query.to) {
      where.push("p.created_at < datetime(?, '+1 day')");
      params.push(text(query.to, 30));
    }
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  router.get('/prompts', (req, res) => {
    const { sql, params } = promptFilter(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = text(req.query.q, 200).toLowerCase();

    // Content is encrypted at rest, so text search happens after decryption.
    const rows = db
      .prepare(
        `SELECT p.id, p.student_id, u.email, u.display_name, p.subject_id, p.subject_name,
                p.conversation_id, p.content_enc, p.flag, p.created_at
         FROM prompt_logs p JOIN users u ON u.id = p.student_id
         ${sql} ORDER BY p.created_at DESC, p.id DESC`
      )
      .all(...params)
      .map((r) => ({
        id: r.id,
        studentId: r.student_id,
        studentEmail: r.email,
        studentName: r.display_name,
        subjectId: r.subject_id,
        subjectName: r.subject_name,
        conversationId: r.conversation_id,
        content: decrypt(r.content_enc),
        flag: r.flag,
        createdAt: r.created_at,
      }))
      .filter((r) => !search || r.content.toLowerCase().includes(search));

    res.json({ total: rows.length, prompts: rows.slice(offset, offset + limit) });
  });

  router.delete('/prompts/:id', (req, res) => {
    const result = db.prepare('DELETE FROM prompt_logs WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return notFound(res, 'Prompt');
    res.json({ deleted: result.changes });
  });

  // Bulk delete by filter. Deleting everything requires an explicit flag.
  router.delete('/prompts', (req, res) => {
    const { sql, params } = promptFilter(req.query);
    if (!sql && req.query.all !== 'true') {
      return res.status(400).json({ error: 'Add a filter, or pass all=true to delete all prompt history.' });
    }
    const result = db.prepare(`DELETE FROM prompt_logs AS p ${sql}`).run(...params);
    res.json({ deleted: result.changes });
  });

  // ---- Teacher accounts ---------------------------------------------------
  router.get('/admins', (req, res) => {
    const rows = db
      .prepare("SELECT id, email, display_name, created_at, last_login_at FROM users WHERE role = 'admin' ORDER BY email")
      .all();
    res.json({ admins: rows.map((a) => ({ id: a.id, email: a.email, displayName: a.display_name, createdAt: a.created_at, lastLoginAt: a.last_login_at })) });
  });

  router.post('/admins', (req, res) => {
    const email = text(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 10) return res.status(400).json({ error: 'Teacher passwords must be at least 10 characters.' });
    const id = db
      .prepare("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)")
      .run(email, hashPassword(password), text(req.body.displayName, 80) || email.split('@')[0]).lastInsertRowid;
    res.status(201).json({ id });
  });

  router.delete('/admins/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    const result = db.prepare("DELETE FROM users WHERE id = ? AND role = 'admin'").run(id);
    if (!result.changes) return notFound(res, 'Teacher');
    res.json({ ok: true });
  });

  return router;
};
