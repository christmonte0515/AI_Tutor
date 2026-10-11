import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run } from '../lib/feedback.js';
import { formDialog } from '../components/dialog.js';

function restrictionFields(r, kind) {
  const isQ = (r?.kind || kind) === 'question';
  return [
    {
      name: 'description',
      label: isQ ? 'Type of question not to answer' : 'Information never to include',
      type: 'textarea',
      value: r?.description,
      required: true,
      maxlength: 500,
      help: isQ ? 'e.g. "Answers to current exam or homework questions"' : 'e.g. "Working malware or attack code aimed at real systems"',
    },
    {
      name: 'keywords',
      label: 'Blocked keywords (optional, comma-separated)',
      type: 'textarea',
      value: r?.keywords,
      maxlength: 2000,
      help: isQ ? 'Questions containing any of these are refused automatically.' : 'Answers containing any of these are stopped and replaced.',
    },
    { name: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : true },
  ];
}

export async function loadRestrictions() {
  const { restrictions } = await api('GET', '/admin/restrictions');
  for (const kind of ['question', 'response']) {
    const list = $(`restrictions-${kind}`);
    list.innerHTML = '';
    const items = restrictions.filter((r) => r.kind === kind);
    if (!items.length) list.append(h('li', { class: 'muted' }, 'None yet.'));
    for (const r of items) {
      list.append(
        h('li', { class: r.active ? '' : 'inactive' },
          h('div', { class: 'item-main' },
            h('div', {}, r.description, r.active ? null : h('span', { class: 'badge off' }, 'Inactive')),
            r.keywords ? h('div', { class: 'muted small-text keywords' }, `Blocked keywords: ${r.keywords}`) : null),
          h('div', { class: 'row-actions' },
            h('button', {
              class: 'secondary small',
              onclick: async () => {
                const v = await formDialog({ title: 'Edit restriction', fields: restrictionFields(r) });
                if (v) run(async () => { await api('PATCH', `/admin/restrictions/${r.id}`, { ...v, kind: r.kind }); await loadRestrictions(); }, 'Restriction saved.');
              },
            }, 'Edit'),
            h('button', {
              class: 'danger small',
              onclick: () => confirm('Delete this restriction?') &&
                run(async () => { await api('DELETE', `/admin/restrictions/${r.id}`); await loadRestrictions(); }, 'Restriction deleted.'),
            }, 'Delete')))
      );
    }
  }
}

export function initRestrictions() {
  document.querySelectorAll('[data-add-restriction]').forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.dataset.addRestriction;
      const v = await formDialog({ title: kind === 'question' ? 'Add question restriction' : 'Add response restriction', fields: restrictionFields(null, kind), submitLabel: 'Add' });
      if (v) run(async () => { await api('POST', '/admin/restrictions', { ...v, kind }); await loadRestrictions(); }, 'Restriction added.');
    };
  });
}
