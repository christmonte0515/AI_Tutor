const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(dataDir, { recursive: true });

// Secrets come from the environment; otherwise they are generated once and kept
// in the data directory with owner-only permissions.
function loadSecret(envName, fileName) {
  if (process.env[envName]) return process.env[envName];
  const file = path.join(dataDir, fileName);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 3000),
  dataDir,
  dbPath: process.env.DB_PATH || path.join(dataDir, 'ai-tutor.db'),
  jwtSecret: loadSecret('JWT_SECRET', '.jwt-secret'),
  encryptionKey: loadSecret('DATA_ENCRYPTION_KEY', '.data-key'),
  tokenTtl: process.env.TOKEN_TTL || '8h',

  // Empty list = any email domain may sign up.
  allowedEmailDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),

  ollama: {
    baseUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || 'qwen3:1.7b',
    temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.3),
    maxTokens: int(process.env.OLLAMA_MAX_TOKENS, 700),
    contextLength: int(process.env.OLLAMA_NUM_CTX, 8192),
    // How long Ollama keeps the model in memory after a request (avoids reload delays).
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    timeoutMs: int(process.env.OLLAMA_TIMEOUT_MS, 120000),
  },

  // keyword | llm | hybrid | off
  scopeCheck: process.env.SCOPE_CHECK || 'hybrid',
  historyMessages: int(process.env.HISTORY_MESSAGES, 12),
  maxMessageChars: int(process.env.MAX_MESSAGE_CHARS, 2000),
  serveWebClient: process.env.SERVE_WEB_CLIENT !== 'false',
  // 0 = keep prompt history until a teacher deletes it.
  promptRetentionDays: int(process.env.PROMPT_RETENTION_DAYS, 0),

  initialAdmin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
};
