import { state } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { iconTile } from '../components/icon.js';
import { closeSidebar, renderConversationList, loadConversations } from './conversations.js';
import { openConversation } from './chat.js';

export function initTeachers() {
  $('new-chat').onclick = () => showPicker();
  $('teacher-search').addEventListener('input', () => renderTeachers());
}

export async function showPicker() {
  state.streaming?.abort();
  state.current = null;
  renderConversationList();
  closeSidebar();
  $('chat-view').hidden = true;
  $('picker-view').hidden = false;
  const box = $('picker-content');
  box.innerHTML = '<p class="muted">Loading teachers...</p>';
  $('teacher-search').value = '';
  $('teacher-search').parentElement.hidden = true;
  try {
    const { domains } = await api('GET', '/student/subjects');
    state.domains = domains;
    $('teacher-search').parentElement.hidden = !domains.length;
    renderTeachers();
    $('picker-title').focus();
  } catch (err) {
    box.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = err.message;
    box.appendChild(p);
  }
}

function renderTeachers() {
  const box = $('picker-content');
  box.innerHTML = '';
  if (!state.domains.length) {
    box.innerHTML =
      '<div class="banner">Your teacher hasn\'t given you access to any AI teachers yet. Please ask your teacher to enable the subjects you\'re studying.</div>';
    return;
  }
  const q = $('teacher-search').value.trim().toLowerCase();
  let shown = 0;
  for (const d of state.domains) {
    const subjects = d.subjects.filter(
      (s) => !q || `${s.name} ${s.teacherName} ${s.description} ${d.name}`.toLowerCase().includes(q)
    );
    if (!subjects.length) continue;
    shown += subjects.length;
    const section = document.createElement('section');
    section.className = 'domain-group';
    const h = document.createElement('h2');
    h.textContent = d.name;
    const count = document.createElement('span');
    count.className = 'domain-count';
    count.textContent = subjects.length;
    h.appendChild(count);
    const grid = document.createElement('div');
    grid.className = 'teacher-grid';
    for (const s of subjects) {
      const card = document.createElement('button');
      card.className = 'teacher-card';
      const text = document.createElement('span');
      text.className = 'teacher-text';
      const name = document.createElement('strong');
      name.textContent = s.teacherName;
      const subj = document.createElement('span');
      subj.className = 'teacher-subject';
      subj.textContent = s.name;
      const desc = document.createElement('span');
      desc.className = 'teacher-desc';
      desc.textContent = s.description;
      text.append(name, subj, desc);
      card.append(iconTile(s.icon, s.name, 'lg'), text);
      card.onclick = () => startConversation(s.id, card);
      grid.appendChild(card);
    }
    section.append(h, grid);
    box.appendChild(section);
  }
  if (!shown) {
    const p = document.createElement('p');
    p.className = 'muted empty-search';
    p.textContent = 'No teachers match your search.';
    box.appendChild(p);
  }
}

async function startConversation(subjectId, card) {
  card.disabled = true;
  try {
    const { id } = await api('POST', '/student/conversations', { subjectId });
    await loadConversations();
    await openConversation(id);
  } catch (err) {
    alert(err.message);
  } finally {
    card.disabled = false;
  }
}
