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

test('wellbeing and frustration detection', () => {
  assert.ok(guards.detectWellbeingConcern('honestly I want to die'));
  assert.ok(guards.detectWellbeingConcern("I'm being bullied at school"));
  assert.ok(!guards.detectWellbeingConcern('how do I kill a process in linux'));
  assert.ok(guards.detectFrustration("I still don't get it"));
  assert.ok(!guards.detectFrustration('What is a variable?'));
});

test('response keywords are detected in a tutor answer', () => {
  const rs = [
    { kind: 'question', description: 'Exam answers', keywords: 'exam answers, test key' },
    { kind: 'response', description: 'No real exploit code for live sites', keywords: 'rm -rf /' },
  ];
  assert.ok(guards.findResponseViolation('then run rm -rf / to clean up', rs));
  assert.equal(guards.findResponseViolation('can you give me the exam answers', rs), null);
});

test('triage prompt classifies, and only an accepted question is answered', () => {
  const subject = { id: 1, name: 'Operating Systems', teacher_name: 'OS Tutor', domain_name: 'Computer Systems', description: '' };
  const restrictions = [
    { kind: 'question', description: 'Exam answers', keywords: 'exam answers' },
    { kind: 'response', description: 'Personal opinions on politics', keywords: '' },
  ];
  const subjects = [
    { id: 1, name: 'Operating Systems', teacher_name: 'OS Tutor' },
    { id: 2, name: 'Computer Networks', teacher_name: 'Networks Tutor' },
  ];
  const triage = prompts.buildTriagePrompt({ subject, restrictions, subjects, allowedSubjectIds: [1, 2] });
  for (const s of [
    'Exam answers',
    'Blocked keywords: exam answers',
    'explain why it is restricted',
    'focus on their studies',
    'Computer Networks',
    'this chat',
    'this student can ask this tutor',
    'ask their human teacher',
    'decision: answer',
    'decision: restricted',
    'decision: redirect',
  ]) {
    assert.ok(triage.includes(s), `triage missing: ${s}`);
  }
  assert.equal(prompts.parseTriage('decision: answer').decision, 'answer');
  assert.equal(prompts.parseTriage('decision: restricted\nExam answers are restricted.').message, 'Exam answers are restricted.');
  assert.equal(prompts.parseTriage('decision: answer\ndecision: redirect\nAsk the Networks Tutor.').decision, 'redirect');
  assert.equal(prompts.parseTriage('I am not sure').decision, 'answer');
  assert.equal(
    prompts.parseTriage('decision: redirect\n<message to the student> Ask your teacher.').message,
    'Ask your teacher.'
  );
  assert.deepEqual(
    prompts
      .selectHistory([
        { role: 'assistant', kind: 'greeting', content: 'Hi' },
        { role: 'user', kind: 'chat', content: 'What is a pointer?' },
        { role: 'assistant', kind: 'chat', content: 'A pointer stores an address.' },
        { role: 'user', kind: 'chat', content: 'give me the exam answers' },
        { role: 'assistant', kind: 'restricted', content: 'That is restricted.' },
        { role: 'user', kind: 'restricted', content: 'another restricted question' },
        { role: 'assistant', kind: 'restricted', content: 'Also restricted.' },
        { role: 'user', kind: 'chat', content: 'please explain about CSS' },
        { role: 'user', kind: 'chat', content: 'What is malloc?' },
        { role: 'assistant', kind: 'chat', content: 'malloc reserves memory.' },
      ])
      .map((m) => m.content),
    ['Hi', 'What is a pointer?', 'A pointer stores an address.', 'What is malloc?', 'malloc reserves memory.']
  );

  const answer = prompts.buildSystemPrompt({
    subject,
    goals: ['Solve problems independently'],
    restrictions,
    frustrated: true,
  });
  for (const s of ['expert knowledge of Operating Systems', 'A greeting gets a greeting', 'Solve problems independently', 'Personal opinions on politics', 'You are an AI', 'frustrated', '/no_think']) {
    assert.ok(answer.includes(s), `answer missing: ${s}`);
  }
  assert.equal(answer.includes('Exam answers'), false);
});
