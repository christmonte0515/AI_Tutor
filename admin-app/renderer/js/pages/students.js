import { state } from '../state.js';
import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run } from '../lib/feedback.js';
import { fmt } from '../lib/format.js';
import { loadCatalog, allSubjects } from './subjects.js';

export async function loadStudents() {
  if (!state.catalog.length) await loadCatalog();
  state.students = (await api('GET', '/admin/students')).students;
  const ids = new Set(state.students.map((s) => s.id));
  state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
  renderStudents();
  renderAccessPanel();
}

export function initStudents() {
  $('student-search').oninput = () => renderStudents();
  $('select-all-students').onchange = (e) => {
    const q = $('student-search').value.trim().toLowerCase();
    for (const s of state.students) {
      if (q && !`${s.displayName} ${s.email}`.toLowerCase().includes(q)) continue;
      e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
    }
    state.editing = null;
    renderStudents();
    renderAccessPanel();
  };
}

function renderStudents() {
  const q = $('student-search').value.trim().toLowerCase();
  const rows = state.students.filter((s) => !q || `${s.displayName} ${s.email}`.toLowerCase().includes(q));
  $('student-count').textContent = `${rows.length} of ${state.students.length} students`;
  const total = allSubjects().length;
  const tbody = $('student-rows');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, state.students.length ? 'No students match your search.' : 'No students have signed up yet.')));
  }
  for (const s of rows) {
    const names = allSubjects().filter((sub) => s.subjectIds.includes(sub.id)).map((sub) => sub.name);
    tbody.append(
      h(
        'tr',
        { class: state.editing === s.id ? 'selected' : '' },
        h('td', {}, h('input', {
          type: 'checkbox',
          checked: state.selected.has(s.id),
          'aria-label': `Select ${s.displayName}`,
          onchange: (e) => {
            e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
            state.editing = null;
            renderAccessPanel();
          },
        })),
        h('td', {}, h('strong', {}, s.displayName), h('div', { class: 'muted small-text' }, s.email)),
        h('td', { title: names.join(', ') }, names.length ? `${names.length} / ${total}` : h('span', { class: 'badge warn' }, 'None')),
        h('td', { class: 'small-text' }, fmt(s.lastLoginAt)),
        h('td', {}, h('span', { class: `badge ${s.active ? 'ok' : 'off'}` }, s.active ? 'Active' : 'Deactivated')),
        h(
          'td',
          { class: 'row-actions' },
          h('div', { class: 'row-actions' },
            h('button', { class: 'secondary small', onclick: () => editStudentAccess(s.id) }, 'Edit access'),
            h('button', {
              class: 'secondary small',
              onclick: () => run(async () => {
                await api('PATCH', `/admin/students/${s.id}`, { active: !s.active });
                await loadStudents();
              }, s.active ? 'Student deactivated.' : 'Student activated.'),
            }, s.active ? 'Deactivate' : 'Activate'),
            h('button', {
              class: 'danger small',
              'aria-label': `Delete ${s.displayName}`,
              onclick: () => {
                if (!confirm(`Delete ${s.displayName} (${s.email})? Their conversations and prompt history will be permanently deleted.`)) return;
                run(async () => {
                  await api('DELETE', `/admin/students/${s.id}`);
                  if (state.editing === s.id) state.editing = null;
                  await loadStudents();
                }, 'Student deleted.');
              },
            }, 'Delete')
          )
        )
      )
    );
  }
  $('select-all-students').checked = rows.length > 0 && rows.every((s) => state.selected.has(s.id));
}

function editStudentAccess(id) {
  state.editing = id;
  renderStudents();
  renderAccessPanel();
  $('access-title').focus();
}

function checklist(checkedIds) {
  const box = $('access-checklist');
  box.innerHTML = '';
  for (const d of state.catalog) {
    if (!d.subjects.length) continue;
    const boxes = d.subjects.map((s) =>
      h('div', { class: 'check' },
        h('input', { type: 'checkbox', id: `acc-${s.id}`, value: s.id, checked: checkedIds.has(s.id) }),
        h('label', { for: `acc-${s.id}` }, s.name))
    );
    const toggleAll = h('button', {
      type: 'button',
      class: 'link small-text',
      onclick: () => {
        const inputs = boxes.map((b) => b.querySelector('input'));
        const allOn = inputs.every((i) => i.checked);
        inputs.forEach((i) => (i.checked = !allOn));
      },
    }, 'Toggle all');
    box.append(h('fieldset', {}, h('legend', {}, d.name, ' ', toggleAll), boxes));
  }
}

const checkedSubjects = () => [...$('access-checklist').querySelectorAll('input:checked')].map((i) => Number(i.value));

function renderAccessPanel() {
  const panel = $('access-panel');
  const actions = $('access-actions');
  actions.innerHTML = '';
  const student = state.students.find((s) => s.id === state.editing);
  $('access-title').setAttribute('tabindex', '-1');

  if (student) {
    panel.hidden = false;
    $('access-title').textContent = `AI teachers for ${student.displayName}`;
    $('access-help').textContent = 'The student can only use the checked teachers. Unchecking a teacher locks existing chats with that teacher.';
    checklist(new Set(student.subjectIds));
    actions.append(
      h('button', { class: 'secondary', onclick: () => { state.editing = null; renderStudents(); renderAccessPanel(); } }, 'Close'),
      h('button', {
        class: 'primary',
        onclick: () => run(async () => {
          await api('PUT', `/admin/students/${student.id}/subjects`, { subjectIds: checkedSubjects() });
          state.editing = null;
          await loadStudents();
        }, 'Access saved.'),
      }, 'Save access')
    );
  } else if (state.selected.size) {
    panel.hidden = false;
    $('access-title').textContent = `Bulk change for ${state.selected.size} selected student(s)`;
    $('access-help').textContent = 'Check the teachers to grant or revoke. Other teachers are left unchanged.';
    checklist(new Set());
    const bulk = (mode) => run(async () => {
      const subjectIds = checkedSubjects();
      if (!subjectIds.length) throw new Error('Check at least one teacher first.');
      await api('POST', '/admin/students/bulk-subjects', { studentIds: [...state.selected], subjectIds, mode });
      await loadStudents();
    }, mode === 'add' ? 'Access granted.' : 'Access revoked.');
    actions.append(
      h('button', { class: 'danger', onclick: () => bulk('remove') }, 'Revoke from selected'),
      h('button', { class: 'primary', onclick: () => bulk('add') }, 'Grant to selected')
    );
  } else {
    panel.hidden = true;
  }
}
