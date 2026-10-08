const jwt = require('jsonwebtoken');
const config = require('./config');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.tokenTtl });
}

// The user row is re-read on every request so deactivation and deletion take
// effect immediately, without waiting for the token to expire.
function requireAuth(db, role) {
  const findUser = db.prepare('SELECT id, email, role, display_name, active FROM users WHERE id = ?');
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    const user = findUser.get(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'This account is not active.' });
    if (role && user.role !== role) return res.status(403).json({ error: 'You do not have access to this area.' });
    req.user = user;
    next();
  };
}

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, rateLimit };
