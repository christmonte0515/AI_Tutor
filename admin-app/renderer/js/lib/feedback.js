import { $ } from './dom.js';

export function announce(text) {
  $('sr-status').textContent = '';
  setTimeout(() => ($('sr-status').textContent = text), 50);
}

export async function run(fn, success) {
  try {
    await fn();
    if (success) announce(success);
  } catch (err) {
    alert(err.message);
  }
}
