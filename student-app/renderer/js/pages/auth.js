import { state, defaultServer } from '../state.js';
import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { announce } from '../lib/feedback.js';
import { initials } from '../lib/format.js';
import { registerSignOut } from '../session.js';
import { loadConversations } from './conversations.js';
import { showPicker } from './teachers.js';

const AUTH_LOGOS = ['python', 'openjdk', 'javascript', 'linux', 'cisco', 'mysql', 'kalilinux', 'tensorflow'];

function renderAuthLogos() {
  const strip = $('auth-logos');
  strip.innerHTML = '';
  for (const slug of AUTH_LOGOS) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `${state.server}/icons/${slug}.svg`;
    img.onerror = () => img.remove();
    strip.appendChild(img);
  }
}

function showAuthTab(which) {
  const login = which === 'login';
  $('tab-login').setAttribute('aria-selected', String(login));
  $('tab-signup').setAttribute('aria-selected', String(!login));
  $('login-form').hidden = !login;
  $('signup-form').hidden = login;
  $('auth-error').textContent = '';
}

async function withButton(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  $('auth-error').textContent = '';
  try {
    await fn();
  } catch (err) {
    $('auth-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function signedIn({ token, user }) {
  state.token = token;
  state.user = user;
  $('login-password').value = '';
  $('signup-password').value = '';
  $('signup-password2').value = '';
  $('auth-view').hidden = true;
  $('app-view').hidden = false;
  $('user-name').textContent = user.displayName || user.email;
  $('user-avatar').textContent = initials(user.displayName || user.email);
  $('picker-greeting').textContent = `Hi ${(user.displayName || '').split(' ')[0] || 'there'} 👋`;
  loadConversations().then(() => showPicker());
}

function signOut(message) {
  state.streaming?.abort();
  state.token = null;
  state.user = null;
  state.current = null;
  state.conversations = [];
  $('messages').innerHTML = '';
  $('app-view').hidden = true;
  $('auth-view').hidden = false;
  showAuthTab('login');
  if (message) $('auth-error').textContent = message;
  $('login-email').focus();
}

export function initAuth() {
  registerSignOut(signOut);

  $('tab-login').onclick = () => showAuthTab('login');
  $('tab-signup').onclick = () => showAuthTab('signup');

  $('server-url').value = state.server;
  $('save-server').onclick = () => {
    state.server = $('server-url').value.trim().replace(/\/$/, '') || defaultServer;
    localStorage.setItem('serverUrl', state.server);
    $('auth-error').textContent = '';
    renderAuthLogos();
    announce('Server address saved.');
  };

  $('login-form').onsubmit = (e) => {
    e.preventDefault();
    withButton(e.target, async () => {
      const data = await api('POST', '/auth/login', {
        email: $('login-email').value,
        password: $('login-password').value,
        app: 'student',
      });
      signedIn(data);
    });
  };

  $('signup-form').onsubmit = (e) => {
    e.preventDefault();
    withButton(e.target, async () => {
      if ($('signup-password').value !== $('signup-password2').value) throw new Error('The two passwords do not match.');
      const data = await api('POST', '/auth/signup', {
        displayName: $('signup-name').value,
        email: $('signup-email').value,
        password: $('signup-password').value,
      });
      signedIn(data);
    });
  };

  $('logout').onclick = () => signOut();
  renderAuthLogos();
  $('auth-view').hidden = false;
  $('login-email').focus();
}
