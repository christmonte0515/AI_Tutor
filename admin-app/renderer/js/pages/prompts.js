import { state } from '../state.js';
import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run, announce } from '../lib/feedback.js';
import { fmt } from '../lib/format.js';
import { formDialog } from '../components/dialog.js';
import { loadCatalog, allSubjects } from './subjects.js';

const FLAG_LABELS = { wellbeing: 'Wellbeing concern', restricted: 'Restricted topic' };

export async function fillPromptFilters() {
  if (!state.students.length) state.students = (await api('GET', '/admin/students')).students;
  if (!state.catalog.length) await loadCatalog();
  const fillSelect = (sel, items, label) => {
    const current = sel.value;
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, label), items.map((i) => h('option', { value: String(i.id) }, i.label)));
    sel.value = current;
  };
  fillSelect($('f-student'), state.students.map((s) => ({ id: s.id, label: `${s.displayName} (${s.email})` })), 'All students');
  fillSelect($('f-subject'), allSubjects().map((s) => ({ id: s.id, label: s.name })), 'All subjects');
}

function promptQuery() {
  const p = new URLSearchParams();
  if ($('f-student').value) p.set('studentId', $('f-student').value);
  if ($('f-subject').value) p.set('subjectId', $('f-subject').value);
  if ($('f-from').value) p.set('from', $('f-from').value);
  if ($('f-to').value) p.set('to', $('f-to').value);
  if ($('f-flagged').checked) p.set('flagged', 'true');
  return p;
}

export async function loadPrompts() {
  const p = promptQuery();
  if ($('f-q').value.trim()) p.set('q', $('f-q').value.trim());
  p.set('limit', state.prompts.limit);
  p.set('offset', state.prompts.offset);
  const data = await api('GET', `/admin/prompts?${p}`);
  state.prompts.total = data.total;
  const tbody = $('prompt-rows');
  tbody.innerHTML = '';
  if (!data.prompts.length) tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'No prompts match these filters.')));
  for (const r of data.prompts) {
    tbody.append(
      h('tr', { class: r.flag ? 'flagged' : '' },
        h('td', { class: 'small-text nowrap' }, fmt(r.createdAt)),
        h('td', {}, h('strong', {}, r.studentName), h('div', { class: 'muted small-text' }, r.studentEmail)),
        h('td', { class: 'small-text' }, r.subjectName),
        h('td', { class: 'prompt-text' }, r.content),
        h('td', {}, r.flag ? h('span', { class: `badge ${r.flag === 'wellbeing' ? 'alert' : 'warn'}` }, FLAG_LABELS[r.flag] || r.flag) : ''),
        h('td', {}, h('button', {
          class: 'danger small',
          'aria-label': 'Delete this prompt',
          onclick: () => confirm('Delete this prompt from the history?') &&
            run(async () => { await api('DELETE', `/admin/prompts/${r.id}`); await loadPrompts(); }, 'Prompt deleted.'),
        }, 'Delete')))
    );
  }
  const { offset, limit, total } = state.prompts;
  $('prompt-count').textContent = `${total} prompt(s)`;
  $('page-info').textContent = total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '';
  $('prev-page').disabled = offset === 0;
  $('next-page').disabled = offset + limit >= total;
}

export function initPrompts() {
  $('prompt-filters').onsubmit = (e) => {
    e.preventDefault();
    state.prompts.offset = 0;
    run(loadPrompts);
  };
  $('f-reset').onclick = () => {
    $('prompt-filters').reset();
    state.prompts.offset = 0;
    run(loadPrompts);
  };
  $('prev-page').onclick = () => {
    state.prompts.offset = Math.max(0, state.prompts.offset - state.prompts.limit);
    run(loadPrompts);
  };
  $('next-page').onclick = () => {
    state.prompts.offset += state.prompts.limit;
    run(loadPrompts);
  };

  $('delete-filtered').onclick = () => {
    const p = promptQuery();
    if (![...p.keys()].length) return alert('Choose a student, subject, date range or "flagged only" first. Use "Delete all history" to delete everything.');
    if ($('f-q').value.trim()) return alert('Text search cannot be used for bulk deletion. Clear the search box, or delete entries one by one.');
    if (!confirm('Permanently delete all prompt history matching the current filters?')) return;
    run(async () => {
      const { deleted } = await api('DELETE', `/admin/prompts?${p}`);
      state.prompts.offset = 0;
      await loadPrompts();
      announce(`${deleted} prompt(s) deleted.`);
    });
  };

  $('delete-all').onclick = async () => {
    const v = await formDialog({
      title: 'Delete all prompt history?',
      submitLabel: 'Delete everything',
      submitClass: 'danger',
      fields: [{ name: 'confirm', label: 'This permanently deletes the history of ALL students. Type DELETE to confirm.', required: true }],
    });
    if (v?.confirm !== 'DELETE') return;
    run(async () => {
      const { deleted } = await api('DELETE', '/admin/prompts?all=true');
      state.prompts.offset = 0;
      await loadPrompts();
      announce(`${deleted} prompt(s) deleted.`);
    });
  };
}
