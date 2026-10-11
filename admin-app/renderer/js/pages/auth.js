import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { announce } from '../lib/feedback.js';
import { state, defaultServer } from '../state.js';
import { loadCatalog } from './subjects.js';
import { showPanel } from '../nav.js';

export function signOut(message) {
  state.token = null;
  state.user = null;
  $('app-view').hidden = true;
  $('auth-view').hidden = false;
  $('auth-error').textContent = message || '';
  $('login-email').focus();
}

export function initAuth() {
  $('server-url').value = state.server;
  $('save-server').onclick = () => {
    state.server = $('server-url').value.trim().replace(/\/$/, '') || defaultServer;
    localStorage.setItem('serverUrl', state.server);
    announce('Server address saved.');
  };

  $('login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('auth-error').textContent = '';
    try {
      const data = await api('POST', '/auth/login', {
        email: $('login-email').value,
        password: $('login-password').value,
        app: 'admin',
      });
      state.token = data.token;
      state.user = data.user;
      $('login-password').value = '';
      $('auth-view').hidden = true;
      $('app-view').hidden = false;
      $('user-name').textContent = data.user.displayName || data.user.email;
      await loadCatalog();
      showPanel('students');
    } catch (err) {
      $('auth-error').textContent = err.message;
    }
  };

  $('logout').onclick = () => signOut();
  $('auth-view').hidden = false;
  $('login-email').focus();
}
