import { $, h } from '../lib/dom.js';
import { iconInput } from './icon.js';

export function formDialog({ title, fields, submitLabel = 'Save', submitClass = 'primary' }) {
  return new Promise((resolve) => {
    const dialog = $('form-dialog');
    $('dialog-title').textContent = title;
    $('dialog-submit').textContent = submitLabel;
    $('dialog-submit').className = submitClass;
    $('dialog-error').textContent = '';
    const box = $('dialog-fields');
    box.innerHTML = '';
    const inputs = {};
    for (const f of fields) {
      const id = `df-${f.name}`;
      let input;
      if (f.type === 'icon') {
        input = iconInput(id, f.value);
        inputs[f.name] = input.querySelector('input');
        box.append(h('div', {}, h('label', { for: id }, f.label), input, f.help ? h('p', { class: 'help' }, f.help) : null));
        continue;
      }
      if (f.type === 'textarea') input = h('textarea', { id, rows: f.rows || 3, maxlength: f.maxlength });
      else if (f.type === 'select') input = h('select', { id }, f.options.map((o) => h('option', { value: o.value }, o.label)));
      else if (f.type === 'checkbox') input = h('input', { id, type: 'checkbox' });
      else input = h('input', { id, type: f.type || 'text', maxlength: f.maxlength, autocomplete: 'off' });
      if (f.type === 'checkbox') input.checked = !!f.value;
      else input.value = f.value ?? '';
      if (f.required) input.required = true;
      inputs[f.name] = input;
      const help = f.help ? h('p', { class: 'help', id: `${id}-help` }, f.help) : null;
      if (help) input.setAttribute('aria-describedby', help.id);
      box.append(
        f.type === 'checkbox'
          ? h('div', { class: 'check' }, input, h('label', { for: id }, f.label))
          : h('div', {}, h('label', { for: id }, f.label), input, help)
      );
    }

    const close = (value) => {
      $('dialog-form').onsubmit = null;
      $('dialog-cancel').onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };
    $('dialog-form').onsubmit = (e) => {
      e.preventDefault();
      const values = {};
      for (const [k, el] of Object.entries(inputs)) values[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
      close(values);
    };
    $('dialog-cancel').onclick = () => close(null);
    dialog.onclose = () => close(null);
    dialog.showModal();
    Object.values(inputs)[0]?.focus();
  });
}
