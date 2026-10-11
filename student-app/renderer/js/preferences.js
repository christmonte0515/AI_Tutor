import { $ } from './lib/dom.js';

const prefs = {
  font: Number(localStorage.getItem('fontScale') || 1),
  contrast: localStorage.getItem('contrast') === '1',
};

function applyPrefs() {
  document.documentElement.style.setProperty('--font-scale', prefs.font);
  document.body.classList.toggle('high-contrast', prefs.contrast);
  $('contrast').setAttribute('aria-pressed', String(prefs.contrast));
  localStorage.setItem('fontScale', prefs.font);
  localStorage.setItem('contrast', prefs.contrast ? '1' : '0');
}

export function initPreferences() {
  $('font-up').onclick = () => {
    prefs.font = Math.min(1.6, +(prefs.font + 0.1).toFixed(1));
    applyPrefs();
  };
  $('font-down').onclick = () => {
    prefs.font = Math.max(0.8, +(prefs.font - 0.1).toFixed(1));
    applyPrefs();
  };
  $('contrast').onclick = () => {
    prefs.contrast = !prefs.contrast;
    applyPrefs();
  };
  applyPrefs();
}
