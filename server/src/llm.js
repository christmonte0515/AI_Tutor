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

const { ollama } = config;

function withTimeout(signal) {
  const timeout = AbortSignal.timeout(ollama.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// Models that don't support thinking reject the `think` option; remember that
// and retry without it.
let thinkSupported = true;

async function chatRequest({ messages, stream, temperature, maxTokens }, signal) {
  const send = () =>
    fetch(`${ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollama.model,
        messages,
        stream,
        ...(thinkSupported ? { think: false } : {}),
        keep_alive: ollama.keepAlive,
        options: { temperature, num_predict: maxTokens, num_ctx: ollama.contextLength },
      }),
      signal: withTimeout(signal),
    });

  let res = await send();
  if (!res.ok) {
    let detail = await res.text().catch(() => '');
    if (thinkSupported && /think/i.test(detail)) {
      thinkSupported = false;
      res = await send();
      if (res.ok) return res;
      detail = await res.text().catch(() => '');
    }
    if (res.status === 404 && /model/i.test(detail)) {
      throw new Error(`Ollama model "${ollama.model}" is not installed. Run: ollama pull ${ollama.model}`);
    }
    throw new Error(`Ollama returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

async function complete(messages, { maxTokens = 16, temperature = 0, signal } = {}) {
  const res = await chatRequest({ messages, stream: false, temperature, maxTokens }, signal);
  const json = await res.json();
  return stripThink(json.message?.content || '');
}

// Calls onToken(text) for each visible chunk; returns the full visible answer.
// Ollama streams newline-delimited JSON objects.
async function streamChat(messages, { onToken, signal } = {}) {
  const res = await chatRequest(
    { messages, stream: true, temperature: ollama.temperature, maxTokens: ollama.maxTokens },
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
  const handleLine = (line) => {
    if (!line.trim()) return;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    if (data.message?.content) emit(filter.push(data.message.content));
  };

  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = pending.indexOf('\n')) !== -1) {
      handleLine(pending.slice(0, nl));
      pending = pending.slice(nl + 1);
    }
  }
  handleLine(pending);
  emit(filter.flush());
  return full.trim();
}

const modelMatches = (name) => name === ollama.model || name === `${ollama.model}:latest`;

async function health() {
  try {
    const res = await fetch(`${ollama.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const models = (json.models || []).map((m) => m.name || m.model);
    return { ok: true, models, modelInstalled: models.some(modelMatches) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Loads the model into memory so the first student doesn't wait for it.
async function warmUp() {
  const res = await fetch(`${ollama.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollama.model, keep_alive: ollama.keepAlive }),
    signal: AbortSignal.timeout(ollama.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await res.text();
}

module.exports = { ThinkFilter, stripThink, complete, streamChat, health, warmUp };
