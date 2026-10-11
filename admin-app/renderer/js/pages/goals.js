import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run } from '../lib/feedback.js';
import { formDialog } from '../components/dialog.js';

export async function loadGoals() {
  const { goals } = await api('GET', '/admin/goals');
  const list = $('goal-list');
  list.innerHTML = '';
  if (!goals.length) list.append(h('li', { class: 'muted' }, 'No learning goals yet.'));
  for (const g of goals) {
    list.append(
      h('li', { class: g.active ? '' : 'inactive' },
        h('div', { class: 'item-main' }, g.text, g.active ? null : h('span', { class: 'badge off' }, 'Inactive')),
        h('div', { class: 'row-actions' },
          h('button', {
            class: 'secondary small',
            onclick: async () => {
              const v = await formDialog({
                title: 'Edit learning goal',
                fields: [
                  { name: 'text', label: 'Goal', type: 'textarea', value: g.text, required: true, maxlength: 1000 },
                  { name: 'active', label: 'Active (included in prompts)', type: 'checkbox', value: g.active },
                ],
              });
              if (v) run(async () => { await api('PATCH', `/admin/goals/${g.id}`, v); await loadGoals(); }, 'Goal saved.');
            },
          }, 'Edit'),
          h('button', {
            class: 'danger small',
            onclick: () => confirm('Delete this learning goal?') &&
              run(async () => { await api('DELETE', `/admin/goals/${g.id}`); await loadGoals(); }, 'Goal deleted.'),
          }, 'Delete')))
    );
  }
}

export function initGoals() {
  $('goal-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('goal-text').value.trim();
    if (!text) return;
    run(async () => {
      await api('POST', '/admin/goals', { text });
      $('goal-text').value = '';
      await loadGoals();
    }, 'Goal added.');
  };
}
