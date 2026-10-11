import { setUnauthorizedHandler } from './lib/api.js';
import { initAuth, signOut } from './pages/auth.js';
import { initNav } from './nav.js';
import { initStudents } from './pages/students.js';
import { initSubjects } from './pages/subjects.js';
import { initRestrictions } from './pages/restrictions.js';
import { initGoals } from './pages/goals.js';
import { initPrompts } from './pages/prompts.js';
import { initSettings } from './pages/settings.js';

setUnauthorizedHandler(signOut);
initAuth();
initNav();
initStudents();
initSubjects();
initRestrictions();
initGoals();
initPrompts();
initSettings();
