(function () {
  const $ = (id) => document.getElementById(id);

  const defaultServer = (window.appConfig && window.appConfig.serverUrl) || window.location.origin;
  const state = {
    server: localStorage.getItem('serverUrl') || defaultServer,
    // Kept in memory only, so closing the app signs the student out (shared lab computers).
    token: null,
    user: null,
    conversations: [],
    domains: [],
    current: null,
    streaming: null,
  };

  const QUICK = {
    hint: 'Can you give me a hint for the next step, without giving me the full answer?',
    again: "I didn't quite get that. Can you explain it another way, maybe with a simpler example or an analogy?",
    quiz: 'Can you ask me a short question to check whether I really understand this so far?',
    plan: 'Can you help me make a step-by-step plan for how to approach this, so I can try it myself?',
    mistake: 'I think there might be a mistake in your last answer. Can you double-check it carefully?',
  };

  // ---------------------------------------------------------------- API
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(`${state.server}/api${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Can't reach the AI Tutor server at ${state.server}. Check your connection or the server settings.`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) {
      signOut('Your session has ended. Please sign in again.');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  }

  function announce(text) {
    const el = $('sr-status');
    el.textContent = '';
    setTimeout(() => (el.textContent = text), 50);
  }

  function initials(text) {
    const words = String(text || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
  }

  function hue(text) {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  // Subject logo tile served by the server; falls back to colored initials.
  function iconTile(icon, label, size = 'md') {
    const tile = document.createElement('span');
    tile.className = `icon-tile ${size}`;
    tile.setAttribute('aria-hidden', 'true');
    const fallback = () => {
      tile.classList.add('fallback');
      tile.style.setProperty('--tile-hue', hue(label));
      tile.textContent = initials(label);
    };
    if (icon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = `${state.server}/icons/${encodeURIComponent(icon)}.svg`;
      img.onerror = () => {
        img.remove();
        fallback();
      };
      tile.appendChild(img);
    } else {
      fallback();
    }
    return tile;
  }

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

  function fmtTime(sqlTime) {
    const d = new Date(`${sqlTime.replace(' ', 'T')}Z`);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ---------------------------------------------------------------- Display settings
  const prefs = { font: Number(localStorage.getItem('fontScale') || 1), contrast: localStorage.getItem('contrast') === '1' };
  function applyPrefs() {
    document.documentElement.style.setProperty('--font-scale', prefs.font);
    document.body.classList.toggle('high-contrast', prefs.contrast);
    $('contrast').setAttribute('aria-pressed', String(prefs.contrast));
    localStorage.setItem('fontScale', prefs.font);
    localStorage.setItem('contrast', prefs.contrast ? '1' : '0');
  }
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

  // ---------------------------------------------------------------- Auth
  function showAuthTab(which) {
    const login = which === 'login';
    $('tab-login').setAttribute('aria-selected', String(login));
    $('tab-signup').setAttribute('aria-selected', String(!login));
    $('login-form').hidden = !login;
    $('signup-form').hidden = login;
    $('auth-error').textContent = '';
  }
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
  $('logout').onclick = () => signOut();

  // ---------------------------------------------------------------- Sidebar
  $('toggle-sidebar').onclick = () => {
    const open = $('sidebar').classList.toggle('open');
    $('toggle-sidebar').setAttribute('aria-expanded', String(open));
  };
  const closeSidebar = () => {
    $('sidebar').classList.remove('open');
    $('toggle-sidebar').setAttribute('aria-expanded', 'false');
  };

  async function loadConversations() {
    const data = await api('GET', '/student/conversations');
    state.conversations = data.conversations;
    renderConversationList();
  }

  function renderConversationList() {
    const list = $('conversation-list');
    list.innerHTML = '';
    if (!state.conversations.length) {
      const li = document.createElement('li');
      li.className = 'muted empty';
      li.textContent = 'No conversations yet. Start a new chat!';
      list.appendChild(li);
      return;
    }
    for (const c of state.conversations) {
      const li = document.createElement('li');
      li.className = 'conversation-item' + (state.current?.id === c.id ? ' active' : '');

      const open = document.createElement('button');
      open.className = 'conversation-open';
      if (state.current?.id === c.id) open.setAttribute('aria-current', 'true');
      const teacher = document.createElement('span');
      teacher.className = 'conv-teacher';
      teacher.textContent = c.teacherName + (c.locked ? ' (locked)' : '');
      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = c.title;
      const time = document.createElement('span');
      time.className = 'conv-time';
      time.textContent = fmtTime(c.updatedAt);
      const text = document.createElement('span');
      text.className = 'conv-text';
      text.append(teacher, title);
      open.append(iconTile(c.icon, c.subjectName, 'sm'), text, time);
      open.onclick = () => openConversation(c.id);

      const del = document.createElement('button');
      del.className = 'icon-btn conv-delete';
      del.setAttribute('aria-label', `Delete conversation "${c.title}" with ${c.teacherName}`);
      del.textContent = '🗑';
      del.onclick = () => deleteConversation(c);

      li.append(open, del);
      list.appendChild(li);
    }
  }

  async function deleteConversation(c) {
    if (!confirm(`Delete this conversation with ${c.teacherName}? This can't be undone.`)) return;
    try {
      await api('DELETE', `/student/conversations/${c.id}`);
      if (state.current?.id === c.id) showPicker();
      await loadConversations();
      announce('Conversation deleted.');
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------------------------------------------------------------- Teacher picker
  $('new-chat').onclick = () => showPicker();

  async function showPicker() {
    state.streaming?.abort();
    state.current = null;
    renderConversationList();
    closeSidebar();
    $('chat-view').hidden = true;
    $('picker-view').hidden = false;
    const box = $('picker-content');
    box.innerHTML = '<p class="muted">Loading teachers...</p>';
    $('teacher-search').value = '';
    $('teacher-search').parentElement.hidden = true;
    try {
      const { domains } = await api('GET', '/student/subjects');
      state.domains = domains;
      $('teacher-search').parentElement.hidden = !domains.length;
      renderTeachers();
      $('picker-title').focus();
    } catch (err) {
      box.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = err.message;
      box.appendChild(p);
    }
  }

  $('teacher-search').addEventListener('input', () => renderTeachers());

  function renderTeachers() {
    const box = $('picker-content');
    box.innerHTML = '';
    if (!state.domains.length) {
      box.innerHTML =
        '<div class="banner">Your teacher hasn\'t given you access to any AI teachers yet. Please ask your teacher to enable the subjects you\'re studying.</div>';
      return;
    }
    const q = $('teacher-search').value.trim().toLowerCase();
    let shown = 0;
    for (const d of state.domains) {
      const subjects = d.subjects.filter(
        (s) => !q || `${s.name} ${s.teacherName} ${s.description} ${d.name}`.toLowerCase().includes(q)
      );
      if (!subjects.length) continue;
      shown += subjects.length;
      const section = document.createElement('section');
      section.className = 'domain-group';
      const h = document.createElement('h2');
      h.textContent = d.name;
      const count = document.createElement('span');
      count.className = 'domain-count';
      count.textContent = subjects.length;
      h.appendChild(count);
      const grid = document.createElement('div');
      grid.className = 'teacher-grid';
      for (const s of subjects) {
        const card = document.createElement('button');
        card.className = 'teacher-card';
        const text = document.createElement('span');
        text.className = 'teacher-text';
        const name = document.createElement('strong');
        name.textContent = s.teacherName;
        const subj = document.createElement('span');
        subj.className = 'teacher-subject';
        subj.textContent = s.name;
        const desc = document.createElement('span');
        desc.className = 'teacher-desc';
        desc.textContent = s.description;
        text.append(name, subj, desc);
        card.append(iconTile(s.icon, s.name, 'lg'), text);
        card.onclick = () => startConversation(s.id, card);
        grid.appendChild(card);
      }
      section.append(h, grid);
      box.appendChild(section);
    }
    if (!shown) {
      const p = document.createElement('p');
      p.className = 'muted empty-search';
      p.textContent = 'No teachers match your search.';
      box.appendChild(p);
    }
  }

  async function startConversation(subjectId, card) {
    card.disabled = true;
    try {
      const { id } = await api('POST', '/student/conversations', { subjectId });
      await loadConversations();
      await openConversation(id);
    } catch (err) {
      alert(err.message);
    } finally {
      card.disabled = false;
    }
  }

  // ---------------------------------------------------------------- Chat
  async function openConversation(id) {
    state.streaming?.abort();
    closeSidebar();
    try {
      const data = await api('GET', `/student/conversations/${id}`);
      state.current = data.conversation;
      $('picker-view').hidden = true;
      $('chat-view').hidden = false;
      $('chat-title').textContent = data.conversation.teacherName;
      $('chat-subtitle').textContent = data.conversation.subjectName;
      $('chat-icon').replaceChildren(iconTile(data.conversation.icon, data.conversation.subjectName, 'md'));
      $('locked-banner').hidden = !data.conversation.locked;
      setComposerEnabled(!data.conversation.locked);
      const box = $('messages');
      box.innerHTML = '';
      for (const m of data.messages) addMessage(m.role, m.content, m.kind);
      scrollToBottom(true);
      renderConversationList();
      if (!data.conversation.locked) $('composer-input').focus();
    } catch (err) {
      alert(err.message);
    }
  }

  function setComposerEnabled(enabled) {
    $('composer-input').disabled = !enabled;
    $('send').disabled = !enabled;
    document.querySelectorAll('[data-quick]').forEach((b) => (b.disabled = !enabled));
  }

  function addMessage(role, content, kind) {
    const wrap = document.createElement('article');
    wrap.className = `message ${role}${kind && kind !== 'chat' ? ` kind-${kind}` : ''}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? 'You' : `${state.current?.teacherName || 'Tutor'} (AI)`;
    const body = document.createElement('div');
    body.className = 'message-body';
    setBody(body, role, content);
    const column = document.createElement('div');
    column.className = 'message-column';
    column.append(label, body);
    if (role === 'assistant') wrap.append(iconTile(state.current?.icon, state.current?.subjectName, 'sm'));
    wrap.append(column);
    $('messages').appendChild(wrap);
    return body;
  }

  function setBody(body, role, content) {
    if (role === 'user') body.textContent = content;
    else body.innerHTML = window.renderMarkdown(content);
  }

  function scrollToBottom(force) {
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (force || nearBottom) box.scrollTop = box.scrollHeight;
  }

  $('messages').addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
    const code = btn.closest('.code-block').querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'Copied';
      announce('Code copied to clipboard.');
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    } catch {
      btn.textContent = 'Copy failed';
    }
  });

  const input = $('composer-input');
  input.addEventListener('input', () => {
    $('char-count').textContent = `${input.value.length} / 2000`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('composer').requestSubmit();
    }
  });
  $('composer').onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || state.streaming) return;
    input.value = '';
    $('char-count').textContent = '0 / 2000';
    send(text);
  };
  document.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.onclick = () => {
      if (!state.streaming) send(QUICK[btn.dataset.quick]);
    };
  });
  $('stop').onclick = () => state.streaming?.abort();

  function setStreaming(controller) {
    state.streaming = controller;
    const busy = !!controller;
    $('send').hidden = busy;
    $('stop').hidden = !busy;
    document.querySelectorAll('[data-quick]').forEach((b) => (b.disabled = busy || state.current?.locked));
    $('messages').setAttribute('aria-busy', String(busy));
  }

  async function send(text) {
    const conv = state.current;
    if (!conv) return;
    addMessage('user', text);
    const body = addMessage('assistant', '');
    body.closest('.message').classList.add('pending');
    body.innerHTML = '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>';
    scrollToBottom(true);
    announce(`${conv.teacherName} is thinking...`);

    const controller = new AbortController();
    setStreaming(controller);
    let reply = '';
    let frame = null;
    const paint = () => {
      frame = null;
      setBody(body, 'assistant', reply);
      scrollToBottom();
    };

    try {
      const res = await fetch(`${state.server}/api/student/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({ content: text }),
        signal: controller.signal,
      });
      if (res.status === 401) return signOut('Your session has ended. Please sign in again.');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') reply += event.text;
          else if (event.type === 'replace') reply = event.text;
          else if (event.type === 'error') throw new Error(event.message);
          else if (event.type === 'done' && event.kind && event.kind !== 'chat') {
            body.closest('.message').classList.add(`kind-${event.kind}`);
          }
          if (!frame) frame = requestAnimationFrame(paint);
        }
      }
      if (frame) cancelAnimationFrame(frame);
      paint();
      body.closest('.message').classList.remove('pending');
      announce(`${conv.teacherName} replied: ${body.textContent}`);
    } catch (err) {
      body.closest('.message').classList.remove('pending');
      if (err.name === 'AbortError') {
        setBody(body, 'assistant', reply ? `${reply}\n\n*(stopped)*` : '*(stopped)*');
        announce('Stopped.');
      } else {
        body.closest('.message').classList.add('kind-error');
        body.textContent = err.message;
        announce(err.message);
      }
    } finally {
      if (state.streaming === controller) setStreaming(null);
      loadConversations().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- Start
  renderAuthLogos();
  $('auth-view').hidden = false;
  $('login-email').focus();
})();
