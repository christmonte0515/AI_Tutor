import { state } from '../state.js';
import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run } from '../lib/feedback.js';
import { fmt } from '../lib/format.js';
import { formDialog } from '../components/dialog.js';
import { iconTile } from '../components/icon.js';

export const allSubjects = () => state.catalog.flatMap((d) => d.subjects);

function subjectFields(subject, domainId) {
  return [
    { name: 'name', label: 'Subject name', value: subject?.name, required: true, maxlength: 100 },
    { name: 'icon', label: 'Logo', type: 'icon', value: subject?.icon, help: 'Technology or company logo shown to students. Start typing to search, e.g. "python" or "cisco". Logos from simpleicons.org.' },
    { name: 'teacherName', label: 'AI teacher name', value: subject?.teacherName, maxlength: 100, help: 'Shown to students. Leave empty for "<Subject> Tutor".' },
    {
      name: 'domainId',
      label: 'Domain',
      type: 'select',
      value: String(subject?.domainId ?? domainId),
      options: state.catalog.map((d) => ({ value: String(d.id), label: d.name })),
    },
    { name: 'description', label: 'What this subject covers', type: 'textarea', value: subject?.description, maxlength: 1000, help: 'Given to the AI to define the scope of this teacher.' },
    { name: 'keywords', label: 'Keywords (comma-separated)', type: 'textarea', value: subject?.keywords, maxlength: 2000, help: 'Words and phrases typical for this subject, e.g. "sql, join, primary key".' },
  ];
}

export function renderCatalog() {
  const box = $('catalog');
  if (!box) return;
  box.innerHTML = '';
  const count = allSubjects().length;
  box.append(h('p', { class: 'muted' }, `${state.catalog.length} domains · ${count} subjects`));
  for (const d of state.catalog) {
    box.append(
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, d.name, h('span', { class: 'muted count' }, ` (${d.subjects.length})`)),
          h('div', { class: 'row-actions' },
            h('button', { class: 'primary small', onclick: () => addSubject(d) }, '+ Add subject'),
            h('button', { class: 'secondary small', onclick: () => renameDomain(d) }, 'Rename'),
            h('button', { class: 'danger small', onclick: () => deleteDomain(d) }, 'Delete domain'))),
        d.subjects.length
          ? h('ul', { class: 'item-list' }, d.subjects.map((s) =>
              h('li', {},
                iconTile(s.icon, s.name),
                h('div', { class: 'item-main' },
                  h('strong', {}, s.name), h('span', { class: 'muted' }, ` · ${s.teacherName}`),
                  s.description ? h('div', { class: 'small-text' }, s.description) : null,
                  s.keywords ? h('div', { class: 'muted small-text keywords' }, `Keywords: ${s.keywords}`) : null),
                h('div', { class: 'row-actions' },
                  h('button', { class: 'secondary small', onclick: () => editSubject(s) }, 'Edit'),
                  h('button', { class: 'danger small', onclick: () => deleteSubject(s) }, 'Delete')))))
          : h('p', { class: 'muted' }, 'No subjects in this domain yet.')
      )
    );
  }
}

export async function loadCatalog() {
  state.catalog = (await api('GET', '/admin/catalog')).domains;
  renderCatalog();
}

export function initSubjects() {
  $('add-domain').onclick = async () => {
    const v = await formDialog({ title: 'Add domain', fields: [{ name: 'name', label: 'Domain name', required: true, maxlength: 100 }], submitLabel: 'Add' });
    if (v) run(async () => { await api('POST', '/admin/domains', v); await loadCatalog(); }, 'Domain added.');
  };
}

async function renameDomain(d) {
  const v = await formDialog({ title: 'Rename domain', fields: [{ name: 'name', label: 'Domain name', value: d.name, required: true, maxlength: 100 }] });
  if (v) run(async () => { await api('PATCH', `/admin/domains/${d.id}`, v); await loadCatalog(); }, 'Domain renamed.');
}

function deleteDomain(d) {
  const msg = d.subjects.length
    ? `Delete the domain "${d.name}" and its ${d.subjects.length} subject(s)? All student conversations with those AI teachers will be deleted. Prompt history is kept.`
    : `Delete the domain "${d.name}"?`;
  if (!confirm(msg)) return;
  run(async () => { await api('DELETE', `/admin/domains/${d.id}`); await loadCatalog(); }, 'Domain deleted.');
}

async function addSubject(d) {
  const v = await formDialog({ title: `Add subject to ${d.name}`, fields: subjectFields(null, d.id), submitLabel: 'Add' });
  if (v) run(async () => { await api('POST', '/admin/subjects', v); await loadCatalog(); }, 'Subject added.');
}

async function editSubject(s) {
  const v = await formDialog({ title: `Edit ${s.name}`, fields: subjectFields(s) });
  if (v) run(async () => { await api('PATCH', `/admin/subjects/${s.id}`, v); await loadCatalog(); }, 'Subject saved.');
}

function deleteSubject(s) {
  if (!confirm(`Delete the subject "${s.name}"? Student access and conversations with ${s.teacherName} will be deleted. Prompt history is kept.`)) return;
  run(async () => { await api('DELETE', `/admin/subjects/${s.id}`); await loadCatalog(); }, 'Subject deleted.');
}
