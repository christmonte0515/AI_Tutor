const llm = require('./llm');

function parseKeywords(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word/phrase match that also works for tokens like "c++" or "node.js".
function containsKeyword(text, keyword) {
  const re = new RegExp(`(?<![a-z0-9])${escapeRegex(keyword)}(?![a-z0-9])`, 'i');
  return re.test(text);
}

function matchedKeywords(text, keywords) {
  return keywords.filter((k) => containsKeyword(text, k));
}

const WELLBEING_PATTERNS = [
  /\b(kill|hurt|harm|cut)(ing)? myself\b/i,
  /\bsuicid/i,
  /\bself[- ]?harm/i,
  /\b(want|wanna|going) to die\b/i,
  /\bend (it all|my life)\b/i,
  /\b(i am|i'm|im|being) (bullied|abused|threatened)\b/i,
  /\b(hits|beats|abuses|touches) me\b/i,
  /\bno reason to live\b/i,
];

function detectWellbeingConcern(text) {
  return WELLBEING_PATTERNS.some((re) => re.test(text));
}

const FRUSTRATION_PATTERNS = [
  /\b(still|so|really) (confused|lost|stuck)\b/i,
  /\bi (don'?t|do not|still don'?t) (get|understand) (it|this|anything)\b/i,
  /\bi give up\b/i,
  /\b(this is|it's|its) (stupid|pointless|impossible|too hard)\b/i,
  /\bi('?m| am) (so )?(stupid|dumb|frustrated|bored)\b/i,
  /\bi hate (this|coding|programming|math)\b/i,
  /\?{3,}/,
];

function detectFrustration(text) {
  return FRUSTRATION_PATTERNS.some((re) => re.test(text));
}

function findQuestionRestriction(text, restrictions) {
  return restrictions.find(
    (r) => r.kind === 'question' && matchedKeywords(text, parseKeywords(r.keywords)).length > 0
  );
}

function findResponseViolation(text, restrictions) {
  for (const r of restrictions) {
    if (r.kind !== 'response') continue;
    const hit = matchedKeywords(text, parseKeywords(r.keywords));
    if (hit.length) return { restriction: r, keyword: hit[0] };
  }
  return null;
}

function scoreSubjects(text, subjects) {
  return subjects.map((s) => ({ subject: s, score: matchedKeywords(text, parseKeywords(s.keywords)).length }));
}

// Returns the subject the message clearly belongs to when that is not the
// current tutor's subject; otherwise null (the tutor answers).
function keywordScopeCheck(text, current, allSubjects) {
  const scores = scoreSubjects(text, allSubjects);
  const own = scores.find((s) => s.subject.id === current.id)?.score || 0;
  if (own > 0) return { decision: 'in_scope' };
  const best = scores
    .filter((s) => s.subject.id !== current.id && s.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= 2) return { decision: 'out_of_scope', subject: best.subject };
  return { decision: 'unknown' };
}

const GENERIC_MESSAGE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|why|how|what|again|more|next|hint|continue|got it|i see)\b/i;

async function llmScopeCheck(text, current, allSubjects, previousReply) {
  const list = allSubjects.map((s) => `${s.id}: ${s.name}`).join('\n');
  const system =
    'You route student messages at an IT school to the right subject tutor.\n' +
    `Subjects (id: name):\n${list}\n\n` +
    `The student is currently talking to the "${current.name}" tutor (id ${current.id}).\n` +
    'Reply with ONLY the id number of the subject the message is mainly about. ' +
    `If the message is a greeting, a follow-up, about study skills or motivation, or could reasonably fit "${current.name}", reply ${current.id}. ` +
    `When unsure, reply ${current.id}. /no_think`;
  const context = previousReply ? `Tutor's previous reply (for context): ${previousReply.slice(0, 400)}\n\n` : '';
  const answer = await llm.complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: `${context}Student message: ${text}` },
    ],
    { maxTokens: 8 }
  );
  const id = Number.parseInt((answer.match(/\d+/) || [])[0], 10);
  const match = allSubjects.find((s) => s.id === id);
  if (match && match.id !== current.id) return { decision: 'out_of_scope', subject: match };
  return { decision: 'in_scope' };
}

async function checkScope(text, current, allSubjects, { mode = 'hybrid', previousReply } = {}) {
  if (mode === 'off') return { decision: 'in_scope' };
  if (mode !== 'llm') {
    const result = keywordScopeCheck(text, current, allSubjects);
    if (result.decision !== 'unknown' || mode === 'keyword') return result;
  }
  // Short or generic messages are almost always follow-ups in the current chat.
  if (text.trim().split(/\s+/).length < 4 || GENERIC_MESSAGE.test(text.trim())) {
    return { decision: 'in_scope' };
  }
  try {
    return await llmScopeCheck(text, current, allSubjects, previousReply);
  } catch {
    return { decision: 'in_scope' };
  }
}

module.exports = {
  parseKeywords,
  containsKeyword,
  detectWellbeingConcern,
  detectFrustration,
  findQuestionRestriction,
  findResponseViolation,
  keywordScopeCheck,
  checkScope,
};
