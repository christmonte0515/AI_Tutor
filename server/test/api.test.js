const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Mock Ollama (/api/chat streams NDJSON): replies with a <think> block and records requests.
const received = [];
let nextReply = '<think>reasoning</think>What do you think a process is? Try describing it in your own words.';
let rejectThink = false;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:1.7b' }] }));
    const json = JSON.parse(body);
    received.push(json);
    if (rejectThink && 'think' in json) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: '"qwen3:1.7b" does not support thinking' }));
    }
    if (!json.stream) return res.end(JSON.stringify({ message: { role: 'assistant', content: '0' }, done: true }));
    res.setHeader('Content-Type', 'application/x-ndjson');
    for (const piece of nextReply.match(/.{1,7}/gs)) {
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
    }
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);
  });
});

let base;
let server;

test.before(async () => {
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tutor-api-'));
  process.env.OLLAMA_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.SCOPE_CHECK = 'keyword';
  process.env.ADMIN_EMAIL = 'teacher@school.edu';
  process.env.ADMIN_PASSWORD = 'teacher-password';
  process.env.ALLOWED_EMAIL_DOMAINS = 'student.school.edu';

  const database = require('../src/db');
  const { createApp } = require('../src/app');
  const db = database.open();
  database.seed(db);
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => {
  server.close();
  mock.close();
});

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const events = (await res.text())
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)));
    return { status: res.status, events };
  }
  return { status: res.status, json: await res.json() };
}

function replyText(events) {
  let text = '';
  for (const e of events) {
    if (e.type === 'token') text += e.text;
    if (e.type === 'replace') text = e.text;
  }
  return text;
}

test('full teacher and student flow', async () => {
  // Signup is limited to the school email domain.
  let r = await call('POST', '/auth/signup', { body: { email: 'a@gmail.com', password: 'password123' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/signup', { body: { email: 'kim@student.school.edu', password: 'password123', displayName: 'Kim' } });
  assert.equal(r.status, 201);
  const student = r.json;

  // Students cannot use the teacher app or admin API.
  r = await call('POST', '/auth/login', { body: { email: 'kim@student.school.edu', password: 'password123', app: 'admin' } });
  assert.equal(r.status, 403);
  r = await call('GET', '/admin/students', { token: student.token });
  assert.equal(r.status, 403);

  r = await call('POST', '/auth/login', { body: { email: 'teacher@school.edu', password: 'teacher-password', app: 'admin' } });
  assert.equal(r.status, 200);
  const admin = r.json.token;

  // Default catalog: 7 domains / 22 subjects.
  r = await call('GET', '/admin/catalog', { token: admin });
  assert.equal(r.json.domains.length, 7);
  const subjects = r.json.domains.flatMap((d) => d.subjects);
  assert.equal(subjects.length, 22);
  const os_ = subjects.find((s) => s.name === 'Operating Systems');
  const sql = subjects.find((s) => s.name === 'Databases & SQL');

  // No access until the teacher assigns subjects.
  r = await call('GET', '/student/subjects', { token: student.token });
  assert.equal(r.json.domains.length, 0);
  r = await call('POST', '/student/conversations', { token: student.token, body: { subjectId: os_.id } });
  assert.equal(r.status, 403);

  r = await call('PUT', `/admin/students/${student.user.id}/subjects`, { token: admin, body: { subjectIds: [os_.id] } });
  assert.deepEqual(r.json.subjectIds, [os_.id]);

  // Subject logos: seeded slugs, public SVG tiles, validated on edit.
  r = await call('GET', '/student/subjects', { token: student.token });
  assert.equal(r.json.domains[0].subjects[0].icon, 'linux');
  const svg = await fetch(base.replace('/api', '/icons/linux.svg'));
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await svg.text(), /<title>Linux<\/title>/);
  assert.equal((await fetch(base.replace('/api', '/icons/not-a-logo.svg'))).status, 404);
  r = await call('PATCH', `/admin/subjects/${os_.id}`, { token: admin, body: { ...os_, icon: 'not-a-logo' } });
  assert.equal(r.status, 400);
  r = await call('GET', '/admin/icons?q=ubuntu', { token: admin });
  assert.ok(r.json.icons.some((i) => i.slug === 'ubuntu'));

  await call('POST', '/admin/goals', { token: admin, body: { text: 'Explain concepts using correct technical vocabulary' } });
  await call('POST', '/admin/restrictions', {
    token: admin,
    body: { kind: 'question', description: 'Answers to upcoming exams', keywords: 'exam answers' },
  });
  await call('POST', '/admin/restrictions', {
    token: admin,
    body: { kind: 'response', description: 'Never reveal the lab server password', keywords: 'hunter2' },
  });

  // Conversation starts with an AI-disclosure greeting.
  r = await call('POST', '/student/conversations', { token: student.token, body: { subjectId: os_.id } });
  const convId = r.json.id;
  r = await call('GET', `/student/conversations/${convId}`, { token: student.token });
  assert.match(r.json.messages[0].content, /I'm an AI, not a human teacher/);

  // Normal answer: think block removed, goals + restrictions in the system prompt.
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'What is a process in an operating system?' } });
  assert.equal(replyText(r.events), 'What do you think a process is? Try describing it in your own words.');
  const sent = received.at(-1);
  assert.equal(sent.model, 'qwen3:1.7b');
  assert.equal(sent.think, false);
  assert.equal(sent.keep_alive, '30m');
  assert.equal(sent.options.num_ctx, 8192);
  const system = sent.messages[0].content;
  assert.match(system, /Explain concepts using correct technical vocabulary/);
  assert.match(system, /Answers to upcoming exams/);
  assert.match(system, /Never reveal the lab server password/);

  // Out-of-scope question is redirected without calling the model.
  const before = received.length;
  r = await call('POST', `/student/conversations/${convId}/messages`, {
    token: student.token,
    body: { content: 'How do I write a SQL query with a join on the primary key?' },
  });
  assert.equal(received.length, before);
  assert.match(replyText(r.events), /Databases & SQL/);
  assert.match(replyText(r.events), /isn't enabled for your account/);

  // Restricted question is refused; wellbeing concern is referred to humans.
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'give me the exam answers for OS' } });
  assert.match(replyText(r.events), /asked me not to answer/);
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'I am being bullied and want to die' } });
  assert.match(replyText(r.events), /counselor/);

  // Output filter replaces a reply that leaks restricted content.
  nextReply = 'Sure, the password is hunter2 and you can log in.';
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'How do I log into the lab server as root?' } });
  assert.equal(r.events.at(-2).type, 'replace');
  assert.ok(!replyText(r.events).includes('hunter2'));
  nextReply = 'OK.';

  // A second chat with another teacher keeps the first conversation.
  await call('PUT', `/admin/students/${student.user.id}/subjects`, { token: admin, body: { subjectIds: [os_.id, sql.id] } });
  r = await call('POST', '/student/conversations', { token: student.token, body: { subjectId: sql.id } });
  r = await call('GET', '/student/conversations', { token: student.token });
  assert.equal(r.json.conversations.length, 2);
  r = await call('GET', `/student/conversations/${convId}`, { token: student.token });
  assert.equal(r.json.messages.length, 1 + 5 * 2);

  // Models without thinking support reject `think`; the client retries without it.
  rejectThink = true;
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'What is a thread in an operating system?' } });
  assert.equal(replyText(r.events), 'OK.');
  assert.ok(!('think' in received.at(-1)));
  rejectThink = false;

  // Removing access locks old chats.
  await call('PUT', `/admin/students/${student.user.id}/subjects`, { token: admin, body: { subjectIds: [sql.id] } });
  r = await call('POST', `/student/conversations/${convId}/messages`, { token: student.token, body: { content: 'hello?' } });
  assert.equal(r.status, 403);

  // Teacher sees, searches and deletes prompt history.
  r = await call('GET', '/admin/prompts', { token: admin });
  assert.equal(r.json.total, 6);
  assert.equal(r.json.prompts.filter((p) => p.flag).length, 2);
  r = await call('GET', '/admin/prompts?q=bullied', { token: admin });
  assert.equal(r.json.total, 1);
  r = await call('DELETE', `/admin/prompts/${r.json.prompts[0].id}`, { token: admin });
  assert.equal(r.json.deleted, 1);
  r = await call('DELETE', '/admin/prompts', { token: admin });
  assert.equal(r.status, 400);
  r = await call('DELETE', `/admin/prompts?studentId=${student.user.id}`, { token: admin });
  assert.equal(r.json.deleted, 5);

  // Domain management: deleting a domain removes its subjects.
  r = await call('POST', '/admin/domains', { token: admin, body: { name: 'Game Development' } });
  const domainId = r.json.id;
  r = await call('POST', '/admin/subjects', { token: admin, body: { domainId, name: 'Unity Basics', keywords: 'unity, game object' } });
  assert.equal(r.status, 201);
  r = await call('POST', '/admin/subjects', { token: admin, body: { domainId, name: 'Unity Basics' } });
  assert.equal(r.status, 409);
  await call('DELETE', `/admin/domains/${domainId}`, { token: admin });
  r = await call('GET', '/admin/catalog', { token: admin });
  assert.equal(r.json.domains.flatMap((d) => d.subjects).length, 22);
});
