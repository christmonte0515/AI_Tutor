const express = require('express');
const config = require('../config');
const { hashPassword, verifyPassword } = require('../security');
const { signToken, requireAuth, rateLimit } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, displayName: u.display_name };
}

module.exports = function authRoutes(db) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

  router.post('/signup', limiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim().slice(0, 80);

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid student email address.' });
    const domain = email.split('@')[1];
    if (config.allowedEmailDomains.length && !config.allowedEmailDomains.includes(domain)) {
      return res.status(400).json({
        error: `Please sign up with your school email (${config.allowedEmailDomains.map((d) => '@' + d).join(', ')}).`,
      });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
    }

    const id = db
      .prepare("INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, 'student', ?)")
      .run(email, hashPassword(password), displayName || email.split('@')[0]).lastInsertRowid;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });

  router.post('/login', limiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const app = req.body.app === 'admin' ? 'admin' : 'student';

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated. Please contact your teacher.' });
    if (user.role !== app) {
      return res.status(403).json({
        error: app === 'admin' ? 'This account is not a teacher account.' : 'Teacher accounts must use the Teacher app.',
      });
    }
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  router.get('/me', requireAuth(db), (req, res) => res.json({ user: publicUser(req.user) }));

  return router;
};

module.exports.publicUser = publicUser;
