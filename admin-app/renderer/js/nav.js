import { run } from './lib/feedback.js';
import { loadStudents } from './pages/students.js';
import { loadCatalog } from './pages/subjects.js';
import { loadRestrictions } from './pages/restrictions.js';
import { loadGoals } from './pages/goals.js';
import { fillPromptFilters, loadPrompts } from './pages/prompts.js';
import { loadSettings } from './pages/settings.js';

const loaders = {
  students: loadStudents,
  subjects: loadCatalog,
  restrictions: loadRestrictions,
  goals: loadGoals,
  prompts: () => {
    fillPromptFilters();
    return loadPrompts();
  },
  settings: loadSettings,
};

export function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  document.querySelectorAll('.nav-item').forEach((b) => {
    if (b.dataset.panel === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  run(loaders[name]);
}

export function initNav() {
  document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => showPanel(b.dataset.panel)));
}
