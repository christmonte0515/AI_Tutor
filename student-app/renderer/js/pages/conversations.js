import { state } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { announce } from '../lib/feedback.js';
import { fmtTime, initials } from '../lib/format.js';
import { iconTile } from '../components/icon.js';

let openConversation = () => {};
let showPicker = () => {};

export function bindNavigation({ open, picker }) {
  openConversation = open;
  showPicker = picker;
}

export function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('toggle-sidebar').setAttribute('aria-expanded', 'false');
}

export function initConversations() {
  $('toggle-sidebar').onclick = () => {
    const open = $('sidebar').classList.toggle('open');
    $('toggle-sidebar').setAttribute('aria-expanded', String(open));
  };
}

export async function loadConversations() {
  const data = await api('GET', '/student/conversations');
  state.conversations = data.conversations;
  renderConversationList();
}

export function renderConversationList() {
  const list = $('conversation-list');
  list.innerHTML = '';
  if (!state.conversations.length) {
    const li = document.createElement('li');
    li.className = 'muted empty';
    li.textContent = 'No conversations yet. Start a new chat!';
    list.appendChild(li);
    return;
  }
  for (const c of state.conversations) {
    const li = document.createElement('li');
    li.className = 'conversation-item' + (state.current?.id === c.id ? ' active' : '');

    const open = document.createElement('button');
    open.className = 'conversation-open';
    if (state.current?.id === c.id) open.setAttribute('aria-current', 'true');
    const teacher = document.createElement('span');
    teacher.className = 'conv-teacher';
    teacher.textContent = c.teacherName + (c.locked ? ' (locked)' : '');
    const title = document.createElement('span');
    title.className = 'conv-title';
    title.textContent = c.title;
    const time = document.createElement('span');
    time.className = 'conv-time';
    time.textContent = fmtTime(c.updatedAt);
    const text = document.createElement('span');
    text.className = 'conv-text';
    text.append(teacher, title);
    open.append(iconTile(c.icon, c.subjectName, 'sm'), text, time);
    open.onclick = () => openConversation(c.id);

    const del = document.createElement('button');
    del.className = 'icon-btn conv-delete';
    del.setAttribute('aria-label', `Delete conversation "${c.title}" with ${c.teacherName}`);
    del.textContent = '🗑';
    del.onclick = () => deleteConversation(c);

    li.append(open, del);
    list.appendChild(li);
  }
}

async function deleteConversation(c) {
  if (!confirm(`Delete this conversation with ${c.teacherName}? This can't be undone.`)) return;
  try {
    await api('DELETE', `/student/conversations/${c.id}`);
    if (state.current?.id === c.id) showPicker();
    await loadConversations();
    announce('Conversation deleted.');
  } catch (err) {
    alert(err.message);
  }
}
