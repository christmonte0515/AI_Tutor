const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tutor-unit-'));

const { ThinkFilter, stripThink } = require('../src/llm');
const guards = require('../src/guards');
const prompts = require('../src/prompt');
const { encrypt, decrypt, hashPassword, verifyPassword } = require('../src/security');

test('ThinkFilter strips reasoning split across chunks', () => {
  const f = new ThinkFilter();
  const parts = ['<thi', 'nk>secret plan', '</th', 'ink>\n\nHello', ' <b>world</b>'];
  const out = parts.map((p) => f.push(p)).join('') + f.flush();
  assert.equal(out, 'Hello <b>world</b>');
  assert.equal(stripThink('<think></think>Answer'), 'Answer');
  assert.equal(stripThink('No think block'), 'No think block');
});

test('encryption round-trips and is not plaintext', () => {
  const enc = encrypt('my private question');
  assert.ok(!enc.includes('private'));
  assert.equal(decrypt(enc), 'my private question');
});

test('password hashing verifies only the right password', () => {
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('keyword matching respects word boundaries and symbols', () => {
  assert.ok(guards.containsKeyword('How do I use node.js?', 'node.js'));
  assert.ok(!guards.containsKeyword('javascript is fun', 'java'));
  assert.ok(guards.containsKeyword('What is a SQL JOIN?', 'join'));
});

test('keyword scope check redirects clear out-of-scope questions', () => {
  const subjects = [
    { id: 1, name: 'Python Programming', keywords: 'python, list comprehension, def' },
    { id: 2, name: 'Databases & SQL', keywords: 'sql, join, primary key, table' },
  ];
  const r = guards.keywordScopeCheck('How do I write a SQL join between two tables?', subjects[0], subjects);
  assert.equal(r.decision, 'out_of_scope');
  assert.equal(r.subject.id, 2);
  assert.equal(guards.keywordScopeCheck('Python list comprehension with a sql string', subjects[0], subjects).decision, 'in_scope');
  assert.equal(guards.keywordScopeCheck('Can you explain that again?', subjects[0], subjects).decision, 'unknown');
});

test('wellbeing and frustration detection', () => {
  assert.ok(guards.detectWellbeingConcern('honestly I want to die'));
  assert.ok(guards.detectWellbeingConcern("I'm being bullied at school"));
  assert.ok(!guards.detectWellbeingConcern('how do I kill a process in linux'));
  assert.ok(guards.detectFrustration("I still don't get it"));
  assert.ok(!guards.detectFrustration('What is a variable?'));
});

test('restrictions: question keywords block, response keywords are detected', () => {
  const rs = [
    { kind: 'question', description: 'Exam answers', keywords: 'exam answers, test key' },
    { kind: 'response', description: 'No real exploit code for live sites', keywords: 'rm -rf /' },
  ];
  assert.ok(guards.findQuestionRestriction('can you give me the exam answers', rs));
  assert.ok(!guards.findQuestionRestriction('help me study for the exam', rs));
  assert.ok(guards.findResponseViolation('then run rm -rf / to clean up', rs));
});

test('system prompt includes subject, goals, restrictions and AI disclosure', () => {
  const p = prompts.buildSystemPrompt({
    subject: { name: 'Operating Systems', teacher_name: 'OS Tutor', domain_name: 'Computer Systems', description: '' },
    goals: ['Solve problems independently'],
    restrictions: [{ kind: 'question', description: 'Exam answers' }, { kind: 'response', description: 'Personal opinions on politics' }],
    otherSubjects: ['Computer Networks'],
    frustrated: true,
  });
  for (const s of ['Operating Systems', 'Solve problems independently', 'Exam answers', 'Personal opinions on politics', 'You are an AI', 'Computer Networks', 'frustrated', '/no_think']) {
    assert.ok(p.includes(s), `missing: ${s}`);
  }
});
