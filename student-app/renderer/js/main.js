import { initPreferences } from './preferences.js';
import { initAuth } from './pages/auth.js';
import { bindNavigation, initConversations } from './pages/conversations.js';
import { initTeachers, showPicker } from './pages/teachers.js';
import { initChat, openConversation } from './pages/chat.js';

bindNavigation({ open: openConversation, picker: showPicker });
initPreferences();
initAuth();
initConversations();
initTeachers();
initChat();
