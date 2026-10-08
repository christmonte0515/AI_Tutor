const config = require('./config');

const OPEN = '<think>';
const CLOSE = '</think>';

// Qwen3 may emit <think>...</think> reasoning even with /no_think; students must
// only see the final answer. Tags can be split across streamed chunks.
class ThinkFilter {
  constructor() {
    this.buf = '';
    this.inThink = false;
    this.started = false;
  }

  push(chunk) {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const end = this.buf.indexOf(CLOSE);
        if (end === -1) {
          this.buf = this.buf.slice(-(CLOSE.length - 1));
          break;
        }
        this.buf = this.buf.slice(end + CLOSE.length);
        this.inThink = false;
        continue;
      }
      const start = this.buf.indexOf(OPEN);
      if (start !== -1) {
        out += this.buf.slice(0, start);
        this.buf = this.buf.slice(start + OPEN.length);
        this.inThink = true;
        continue;
      }
      const keep = partialSuffix(this.buf, OPEN);
      out += this.buf.slice(0, this.buf.length - keep);
      this.buf = this.buf.slice(this.buf.length - keep);
      break;
    }
    return this.clean(out);
  }

  flush() {
    const rest = this.inThink ? '' : this.buf;
    this.buf = '';
    return this.clean(rest);
  }

  clean(text) {
    if (!this.started) {
      text = text.replace(/^\s+/, '');
      if (text) this.started = true;
    }
    return text;
  }
}

function partialSuffix(text, tag) {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

function stripThink(text) {
  const f = new ThinkFilter();
  return (f.push(text) + f.flush()).trim();
}

function withTimeout(signal) {
  const timeout = AbortSignal.timeout(config.lmStudio.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(body, signal) {
  const res = await fetch(`${config.lmStudio.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.lmStudio.model, ...body }),
    signal: withTimeout(signal),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LM Studio returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

async function complete(messages, { maxTokens = 16, temperature = 0, signal } = {}) {
  const res = await request({ messages, max_tokens: maxTokens, temperature, stream: false }, signal);
  const json = await res.json();
  return stripThink(json.choices?.[0]?.message?.content || '');
}

// Calls onToken(text) for each visible chunk; returns the full visible answer.
async function streamChat(messages, { onToken, signal } = {}) {
  const res = await request(
    {
      messages,
      stream: true,
      temperature: config.lmStudio.temperature,
      max_tokens: config.lmStudio.maxTokens,
    },
    signal
  );

  const filter = new ThinkFilter();
  const decoder = new TextDecoder();
  let pending = '';
  let full = '';
  const emit = (text) => {
    if (!text) return;
    full += text;
    onToken?.(text);
  };

  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) emit(filter.push(delta));
      } catch {
        // ignore keep-alive or malformed lines
      }
    }
  }
  emit(filter.flush());
  return full.trim();
}

async function health() {
  try {
    const res = await fetch(`${config.lmStudio.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const models = (json.data || []).map((m) => m.id);
    return { ok: true, models, modelLoaded: models.includes(config.lmStudio.model) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { ThinkFilter, stripThink, complete, streamChat, health };
