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

function findResponseViolation(text, restrictions) {
  for (const r of restrictions) {
    if (r.kind !== 'response') continue;
    const hit = matchedKeywords(text, parseKeywords(r.keywords));
    if (hit.length) return { restriction: r, keyword: hit[0] };
  }
  return null;
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

module.exports = {
  parseKeywords,
  containsKeyword,
  detectWellbeingConcern,
  detectFrustration,
  findResponseViolation,
};
