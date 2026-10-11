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

// One local model. Overlapping chats reset the connection and surface as
// "fetch failed", so chat calls run one at a time.
let chatQueue = Promise.resolve();
function enqueueChat(fn) {
  const run = chatQueue.then(fn, fn);
  chatQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function failureText(err) {
  const code = err?.cause?.code;
  const detail = err?.cause?.message || err.message;
  return code ? `${detail} (${code})` : detail;
}

function isTransientFetch(err) {
  if (!err || err.name === 'AbortError' || err.name === 'TimeoutError') return false;
  const code = err.cause?.code || '';
  return (
    err.message === 'fetch failed' ||
    ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
  );
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function chatRequest({ messages, stream, temperature, maxTokens }, signal) {
  console.log(`[llm] prompt\n${messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n')}`);
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

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
      try {
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
    } catch (err) {
      lastError = err;
      if (signal?.aborted || !isTransientFetch(err) || attempt === 3) break;
      console.warn(`[llm] Ollama connection failed (${failureText(err)}). Retry ${attempt} of 2.`);
      await delay(500 * attempt, signal);
    }
  }
  if (isTransientFetch(lastError)) throw new Error(`Could not reach Ollama: ${failureText(lastError)}`);
  throw lastError;
}

async function complete(messages, { maxTokens = 16, temperature = 0, signal } = {}) {
  return enqueueChat(async () => {
    const res = await chatRequest({ messages, stream: false, temperature, maxTokens }, signal);
    const json = await res.json();
    return stripThink(json.message?.content || '');
  });
}

async function readChatStream(messages, { onToken, signal }) {
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

  try {
    for await (const chunk of res.body) {
      pending += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = pending.indexOf('\n')) !== -1) {
        handleLine(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
      }
    }
  } catch (err) {
    if (full) err.partial = true;
    throw err;
  }
  handleLine(pending);
  emit(filter.flush());
  return full.trim();
}

// Calls onToken(text) for each visible chunk; returns the full visible answer.
// Ollama streams newline-delimited JSON objects. A drop before any text is retried once.
async function streamChat(messages, options = {}) {
  return enqueueChat(() => readStreamWithRetry(messages, options));
}

async function readStreamWithRetry(messages, options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await readChatStream(messages, options);
    } catch (err) {
      lastError = err;
      if (options.signal?.aborted || err.partial || !isTransientFetch(err) || attempt === 2) {
        if (isTransientFetch(err)) throw new Error(`Could not reach Ollama: ${failureText(err)}`);
        throw err;
      }
      console.warn(`[llm] Answer stream dropped (${failureText(err)}). Retrying once.`);
      await delay(500, options.signal);
    }
  }
  throw lastError;
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
