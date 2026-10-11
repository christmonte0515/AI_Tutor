import { state } from '../state.js';
import { $, h } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { run } from '../lib/feedback.js';
import { fmt } from '../lib/format.js';
import { formDialog } from '../components/dialog.js';

export async function loadSettings() {
  const [status, { admins }] = await Promise.all([api('GET', '/admin/status'), api('GET', '/admin/admins')]);
  const lm = status.ollama;
  const dl = $('status');
  dl.innerHTML = '';
  const row = (k, v) => dl.append(h('dt', {}, k), h('dd', {}, v));
  row('Ollama address', status.ollamaUrl);
  row('Model', status.model);
  row('Connection', lm.ok ? h('span', { class: 'badge ok' }, 'Connected') : h('span', { class: 'badge alert' }, `Not reachable: ${lm.error}. Start Ollama on the server computer.`));
  if (lm.ok) {
    row('Model installed', lm.modelInstalled
      ? h('span', { class: 'badge ok' }, 'Yes')
      : h('span', { class: 'badge warn' }, `No. Run "ollama pull ${status.model}" on the server. Installed: ${lm.models.join(', ') || 'none'}`));
  }

  const list = $('admin-list');
  list.innerHTML = '';
  for (const a of admins) {
    list.append(
      h('li', {},
        h('div', { class: 'item-main' }, h('strong', {}, a.displayName), h('span', { class: 'muted' }, ` · ${a.email}`),
          h('div', { class: 'muted small-text' }, `Last sign-in: ${fmt(a.lastLoginAt)}`)),
        a.id === state.user.id
          ? h('span', { class: 'muted small-text' }, 'You')
          : h('button', {
              class: 'danger small',
              onclick: () => confirm(`Remove teacher account ${a.email}?`) &&
                run(async () => { await api('DELETE', `/admin/admins/${a.id}`); await loadSettings(); }, 'Teacher removed.'),
            }, 'Remove'))
    );
  }
}

export function initSettings() {
  $('refresh-status').onclick = () => run(loadSettings);

  $('add-admin').onclick = async () => {
    const v = await formDialog({
      title: 'Add teacher account',
      submitLabel: 'Create',
      fields: [
        { name: 'displayName', label: 'Name', maxlength: 80 },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'password', label: 'Initial password (at least 10 characters)', type: 'password', required: true },
      ],
    });
    if (v) run(async () => { await api('POST', '/admin/admins', v); await loadSettings(); }, 'Teacher account created.');
  };
}
