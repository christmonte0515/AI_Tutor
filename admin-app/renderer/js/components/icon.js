import { state } from '../state.js';
import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';

const iconUrl = (slug) => `${state.server}/icons/${encodeURIComponent(slug)}.svg`;

export function iconTile(slug, label) {
  if (!slug) return h('span', { class: 'icon-tile fallback', 'aria-hidden': 'true' }, (label || '?')[0]);
  const img = h('img', { src: iconUrl(slug), alt: '' });
  const tile = h('span', { class: 'icon-tile', 'aria-hidden': 'true' }, img);
  img.onerror = () => tile.replaceChildren((label || '?')[0]);
  return tile;
}

// Logo picker: free text with suggestions from the server's Simple Icons catalog.
export function iconInput(id, value) {
  const listId = `${id}-list`;
  const preview = h('span', { class: 'icon-preview' });
  const input = h('input', { id, type: 'text', list: listId, autocomplete: 'off', placeholder: 'e.g. python, cisco, mysql' });
  const list = h('datalist', { id: listId });
  input.value = value || '';
  let timer;
  const update = () => {
    const slug = input.value.trim().toLowerCase();
    preview.replaceChildren(slug ? iconTile(slug, '?') : h('span', { class: 'muted small-text' }, 'No logo'));
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const { icons } = await api('GET', `/admin/icons?q=${encodeURIComponent(slug)}`);
        list.replaceChildren(...icons.map((i) => h('option', { value: i.slug }, i.title)));
      } catch {
        // suggestions are optional
      }
    }, 200);
  };
  input.addEventListener('input', update);
  update();
  return h('div', { class: 'icon-input' }, preview, input, list);
}
