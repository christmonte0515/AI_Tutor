const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { hashPassword } = require('./security');
const { DEFAULT_CATALOG, DEFAULT_GOALS } = require('./seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
  display_name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  teacher_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_subjects (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS restrictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'response')),
  description TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title_enc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_student ON conversations(student_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content_enc TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

-- Kept separately from conversations so that teachers keep visibility even if a
-- student deletes a chat. Subject name is denormalized for the same reason.
CREATE TABLE IF NOT EXISTS prompt_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  content_enc TEXT NOT NULL,
  flag TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prompt_logs_student ON prompt_logs(student_id, created_at);
`;

function open(dbPath = config.dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(subjects)').all().map((c) => c.name);
  if (!columns.includes('icon')) {
    db.exec("ALTER TABLE subjects ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
    const setIcon = db.prepare('UPDATE subjects SET icon = ? WHERE name = ?');
    for (const d of DEFAULT_CATALOG) for (const s of d.subjects) setIcon.run(s.icon, s.name);
  }
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed(db) {
  const domainCount = db.prepare('SELECT COUNT(*) AS n FROM domains').get().n;
  if (domainCount === 0) {
    transaction(db, () => {
      const insDomain = db.prepare('INSERT INTO domains (name, sort_order) VALUES (?, ?)');
      const insSubject = db.prepare(
        'INSERT INTO subjects (domain_id, name, teacher_name, description, keywords, icon) VALUES (?, ?, ?, ?, ?, ?)'
      );
      DEFAULT_CATALOG.forEach((d, i) => {
        const domainId = insDomain.run(d.domain, i).lastInsertRowid;
        for (const s of d.subjects) {
          insSubject.run(domainId, s.name, `${s.name} Tutor`, s.description, s.keywords, s.icon);
        }
      });
    });
  }

  const goalCount = db.prepare('SELECT COUNT(*) AS n FROM learning_goals').get().n;
  if (goalCount === 0) {
    const ins = db.prepare('INSERT INTO learning_goals (text, sort_order) VALUES (?, ?)');
    DEFAULT_GOALS.forEach((g, i) => ins.run(g, i));
  }

  const { email, password } = config.initialAdmin;
  if (email && password) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!exists) {
      db.prepare("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)").run(
        email,
        hashPassword(password),
        'Administrator'
      );
    }
  }
}

function purgeOldPromptLogs(db, days = config.promptRetentionDays) {
  if (!days) return 0;
  return db.prepare("DELETE FROM prompt_logs WHERE created_at < datetime('now', ?)").run(`-${days} days`).changes;
}

module.exports = { open, seed, transaction, purgeOldPromptLogs };
