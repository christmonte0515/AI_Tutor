import { state } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { announce } from '../lib/feedback.js';
import { iconTile } from '../components/icon.js';
import { renderMarkdown } from '../components/markdown.js';
import { signOut } from '../session.js';
import { closeSidebar, loadConversations, renderConversationList } from './conversations.js';

const QUICK = {
  hint: 'Can you give me a hint for the next step, without giving me the full answer?',
  again: "I didn't quite get that. Can you explain it another way, maybe with a simpler example or an analogy?",
  quiz: 'Can you ask me a short question to check whether I really understand this so far?',
  plan: 'Can you help me make a step-by-step plan for how to approach this, so I can try it myself?',
  mistake: 'I think there might be a mistake in your last answer. Can you double-check it carefully?',
};

export function initChat() {
  $('messages').addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copied';
      announce('Code copied to clipboard.');
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    } catch {
      btn.textContent = 'Copy failed';
    }
  });

  const input = $('composer-input');
  input.addEventListener('input', () => {
    $('char-count').textContent = `${input.value.length} / 2000`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });
  $('composer').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || state.streaming) return;
    input.value = '';
    $('char-count').textContent = '0 / 2000';
    send(text);
  };
  document.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.onclick = () => {
      if (!state.streaming) send(QUICK[btn.dataset.quick]);
    };
  });
  $('stop').onclick = () => state.streaming?.abort();
}

export async function openConversation(id) {
  state.streaming?.abort();
  closeSidebar();
  try {
    const data = await api('GET', `/student/conversations/${id}`);
    state.current = data.conversation;
    $('picker-view').hidden = true;
    $('chat-view').hidden = false;
    $('chat-title').textContent = data.conversation.teacherName;
    $('chat-subtitle').textContent = data.conversation.subjectName;
    $('chat-icon').replaceChildren(iconTile(data.conversation.icon, data.conversation.subjectName, 'md'));
    $('locked-banner').hidden = !data.conversation.locked;
    setComposerEnabled(!data.conversation.locked);
    const box = $('messages');
    box.innerHTML = '';
    for (const m of data.messages) addMessage(m.role, m.content, m.kind);
    scrollToBottom(true);
    renderConversationList();
    if (!data.conversation.locked) $('composer-input').focus();
  } catch (err) {
    alert(err.message);
  }
}

function setComposerEnabled(enabled) {
  $('composer-input').disabled = !enabled;
  $('send').disabled = !enabled;
  document.querySelectorAll('[data-quick]').forEach((b) => (b.disabled = !enabled));
}

function addMessage(role, content, kind) {
  const wrap = document.createElement('article');
  wrap.className = `message ${role}${kind && kind !== 'chat' ? ` kind-${kind}` : ''}`;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'You' : `${state.current?.teacherName || 'Tutor'} (AI)`;
  const body = document.createElement('div');
  body.className = 'message-body';
  setBody(body, role, content);
  const column = document.createElement('div');
  column.className = 'message-column';
  column.append(label, body);
  if (role === 'assistant') wrap.append(iconTile(state.current?.icon, state.current?.subjectName, 'sm'));
  wrap.append(column);
  $('messages').appendChild(wrap);
  return body;
}

function setBody(body, role, content) {
  if (role === 'user') body.textContent = content;
  else body.innerHTML = renderMarkdown(content);
}

function scrollToBottom(force) {
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (force || nearBottom) box.scrollTop = box.scrollHeight;
}

function setStreaming(controller) {
  state.streaming = controller;
  const busy = !!controller;
  $('send').hidden = busy;
  $('stop').hidden = !busy;
  document.querySelectorAll('[data-quick]').forEach((b) => (b.disabled = busy || state.current?.locked));
  $('messages').setAttribute('aria-busy', String(busy));
}

async function send(text) {
  const conv = state.current;
  if (!conv) return;
  addMessage('user', text);
  const body = addMessage('assistant', '');
  body.closest('.message').classList.add('pending');
  body.innerHTML = '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>';
  scrollToBottom(true);
  announce(`${conv.teacherName} is thinking...`);

  const controller = new AbortController();
  setStreaming(controller);
  let reply = '';
  let frame = null;
  const paint = () => {
    frame = null;
    setBody(body, 'assistant', reply);
    scrollToBottom();
  };

  try {
    const res = await fetch(`${state.server}/api/student/conversations/${conv.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ content: text }),
      signal: controller.signal,
    });
    if (res.status === 401) return signOut('Your session has ended. Please sign in again.');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status}).`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'token') reply += event.text;
        else if (event.type === 'replace') reply = event.text;
        else if (event.type === 'error') throw new Error(event.message);
        else if (event.type === 'done' && event.kind && event.kind !== 'chat') {
          body.closest('.message').classList.add(`kind-${event.kind}`);
        }
        if (!frame) frame = requestAnimationFrame(paint);
      }
    }
    if (frame) cancelAnimationFrame(frame);
    paint();
    body.closest('.message').classList.remove('pending');
    announce(`${conv.teacherName} replied: ${body.textContent}`);
  } catch (err) {
    body.closest('.message').classList.remove('pending');
    if (err.name === 'AbortError') {
      setBody(body, 'assistant', reply ? `${reply}\n\n*(stopped)*` : '*(stopped)*');
      announce('Stopped.');
    } else {
      body.closest('.message').classList.add('kind-error');
      body.textContent = err.message;
      announce(err.message);
    }
  } finally {
    if (state.streaming === controller) setStreaming(null);
    loadConversations().catch(() => {});
  }
}
