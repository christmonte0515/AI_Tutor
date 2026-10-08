const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const icons = require('./icons');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');

  // The Electron apps load from file:// and authenticate with bearer tokens
  // (no cookies), so allowing any origin does not expose credentials.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  // Logos are public brand marks, so they need no sign-in (also used on the login screen).
  app.get('/icons/:slug.svg', (req, res) => {
    const svg = icons.tileSvg(req.params.slug);
    if (!svg) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.type('image/svg+xml').send(svg);
  });
  app.use('/api/auth', authRoutes(db));
  app.use('/api/admin', adminRoutes(db));
  app.use('/api/student', studentRoutes(db));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Browser access to the student UI for devices that can't run the Electron app.
  const webClient = path.join(__dirname, '..', '..', 'student-app', 'renderer');
  if (config.serveWebClient && fs.existsSync(webClient)) {
    app.use('/student', express.static(webClient));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (/UNIQUE constraint failed/.test(err.message)) {
      return res.status(409).json({ error: 'An item with that name already exists.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = { createApp };
