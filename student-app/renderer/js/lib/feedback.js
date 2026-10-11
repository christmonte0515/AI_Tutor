import { $ } from './dom.js';

export function announce(text) {
  const el = $('sr-status');
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 50);
}
