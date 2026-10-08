(function () {
  const $ = (id) => document.getElementById(id);

  // Builds DOM nodes; strings are always inserted as text, never as HTML.
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  const defaultServer = (window.appConfig && window.appConfig.serverUrl) || window.location.origin;
  const state = {
    server: localStorage.getItem('serverUrl') || defaultServer,
    token: null,
    user: null,
    catalog: [],
    students: [],
    selected: new Set(),
    editing: null,
    prompts: { offset: 0, limit: 50, total: 0 },
  };

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(`${state.server}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Can't reach the AI Tutor server at ${state.server}.`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.token) signOut('Your session has ended. Please sign in again.');
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
    return data;
  }

  function announce(text) {
    $('sr-status').textContent = '';
    setTimeout(() => ($('sr-status').textContent = text), 50);
  }

  async function run(fn, success) {
    try {
      await fn();
      if (success) announce(success);
    } catch (err) {
      alert(err.message);
    }
  }

  function fmt(sqlTime) {
    if (!sqlTime) return 'Never';
    return new Date(`${sqlTime.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ---------------------------------------------------------------- Form dialog
  function formDialog({ title, fields, submitLabel = 'Save' }) {
    return new Promise((resolve) => {
      const dialog = $('form-dialog');
      $('dialog-title').textContent = title;
      $('dialog-submit').textContent = submitLabel;
      $('dialog-error').textContent = '';
      const box = $('dialog-fields');
      box.innerHTML = '';
      const inputs = {};
      for (const f of fields) {
        const id = `df-${f.name}`;
        let input;
        if (f.type === 'icon') {
          input = iconInput(id, f.value);
          inputs[f.name] = input.querySelector('input');
          box.append(h('div', {}, h('label', { for: id }, f.label), input, f.help ? h('p', { class: 'help' }, f.help) : null));
          continue;
        }
        if (f.type === 'textarea') input = h('textarea', { id, rows: f.rows || 3, maxlength: f.maxlength });
        else if (f.type === 'select') input = h('select', { id }, f.options.map((o) => h('option', { value: o.value }, o.label)));
        else if (f.type === 'checkbox') input = h('input', { id, type: 'checkbox' });
        else input = h('input', { id, type: f.type || 'text', maxlength: f.maxlength, autocomplete: 'off' });
        if (f.type === 'checkbox') input.checked = !!f.value;
        else input.value = f.value ?? '';
        if (f.required) input.required = true;
        inputs[f.name] = input;
        const help = f.help ? h('p', { class: 'help', id: `${id}-help` }, f.help) : null;
        if (help) input.setAttribute('aria-describedby', help.id);
        box.append(
          f.type === 'checkbox'
            ? h('div', { class: 'check' }, input, h('label', { for: id }, f.label))
            : h('div', {}, h('label', { for: id }, f.label), input, help)
        );
      }

      const close = (value) => {
        $('dialog-form').onsubmit = null;
        $('dialog-cancel').onclick = null;
        dialog.onclose = null;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      $('dialog-form').onsubmit = (e) => {
        e.preventDefault();
        const values = {};
        for (const [k, el] of Object.entries(inputs)) values[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
        close(values);
      };
      $('dialog-cancel').onclick = () => close(null);
      dialog.onclose = () => close(null);
      dialog.showModal();
      Object.values(inputs)[0]?.focus();
    });
  }

  const iconUrl = (slug) => `${state.server}/icons/${encodeURIComponent(slug)}.svg`;

  function iconTile(slug, label) {
    if (!slug) return h('span', { class: 'icon-tile fallback', 'aria-hidden': 'true' }, (label || '?')[0]);
    const img = h('img', { src: iconUrl(slug), alt: '' });
    const tile = h('span', { class: 'icon-tile', 'aria-hidden': 'true' }, img);
    img.onerror = () => tile.replaceChildren((label || '?')[0]);
    return tile;
  }

  // Logo picker: free text with suggestions from the server's Simple Icons catalog.
  function iconInput(id, value) {
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

  // ---------------------------------------------------------------- Auth
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

  function signOut(message) {
    state.token = null;
    state.user = null;
    $('app-view').hidden = true;
    $('auth-view').hidden = false;
    $('auth-error').textContent = message || '';
    $('login-email').focus();
  }
  $('logout').onclick = () => signOut();

  // ---------------------------------------------------------------- Navigation
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

  function showPanel(name) {
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `panel-${name}`));
    document.querySelectorAll('.nav-item').forEach((b) => {
      if (b.dataset.panel === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    run(loaders[name]);
  }
  document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => showPanel(b.dataset.panel)));

  async function loadCatalog() {
    state.catalog = (await api('GET', '/admin/catalog')).domains;
    renderCatalog();
  }
  const allSubjects = () => state.catalog.flatMap((d) => d.subjects);

  // ---------------------------------------------------------------- Students & access
  async function loadStudents() {
    if (!state.catalog.length) await loadCatalog();
    state.students = (await api('GET', '/admin/students')).students;
    const ids = new Set(state.students.map((s) => s.id));
    state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
    renderStudents();
    renderAccessPanel();
  }

  $('student-search').oninput = () => renderStudents();

  function renderStudents() {
    const q = $('student-search').value.trim().toLowerCase();
    const rows = state.students.filter((s) => !q || `${s.displayName} ${s.email}`.toLowerCase().includes(q));
    $('student-count').textContent = `${rows.length} of ${state.students.length} students`;
    const total = allSubjects().length;
    const tbody = $('student-rows');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, state.students.length ? 'No students match your search.' : 'No students have signed up yet.')));
    }
    for (const s of rows) {
      const names = allSubjects().filter((sub) => s.subjectIds.includes(sub.id)).map((sub) => sub.name);
      tbody.append(
        h(
          'tr',
          { class: state.editing === s.id ? 'selected' : '' },
          h('td', {}, h('input', {
            type: 'checkbox',
            checked: state.selected.has(s.id),
            'aria-label': `Select ${s.displayName}`,
            onchange: (e) => {
              e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
              state.editing = null;
              renderAccessPanel();
            },
          })),
          h('td', {}, h('strong', {}, s.displayName), h('div', { class: 'muted small-text' }, s.email)),
          h('td', { title: names.join(', ') }, names.length ? `${names.length} / ${total}` : h('span', { class: 'badge warn' }, 'None')),
          h('td', { class: 'small-text' }, fmt(s.lastLoginAt)),
          h('td', {}, h('span', { class: `badge ${s.active ? 'ok' : 'off'}` }, s.active ? 'Active' : 'Deactivated')),
          h(
            'td',
            { class: 'row-actions' },
            h('button', { class: 'secondary small', onclick: () => editStudentAccess(s.id) }, 'Edit access'),
            h('button', {
              class: 'secondary small',
              onclick: () => run(async () => {
                await api('PATCH', `/admin/students/${s.id}`, { active: !s.active });
                await loadStudents();
              }, s.active ? 'Student deactivated.' : 'Student activated.'),
            }, s.active ? 'Deactivate' : 'Activate'),
            h('button', {
              class: 'danger small',
              'aria-label': `Delete ${s.displayName}`,
              onclick: () => {
                if (!confirm(`Delete ${s.displayName} (${s.email})? Their conversations and prompt history will be permanently deleted.`)) return;
                run(async () => {
                  await api('DELETE', `/admin/students/${s.id}`);
                  if (state.editing === s.id) state.editing = null;
                  await loadStudents();
                }, 'Student deleted.');
              },
            }, 'Delete')
          )
        )
      );
    }
    $('select-all-students').checked = rows.length > 0 && rows.every((s) => state.selected.has(s.id));
  }

  $('select-all-students').onchange = (e) => {
    const q = $('student-search').value.trim().toLowerCase();
    for (const s of state.students) {
      if (q && !`${s.displayName} ${s.email}`.toLowerCase().includes(q)) continue;
      e.target.checked ? state.selected.add(s.id) : state.selected.delete(s.id);
    }
    state.editing = null;
    renderStudents();
    renderAccessPanel();
  };

  function editStudentAccess(id) {
    state.editing = id;
    renderStudents();
    renderAccessPanel();
    $('access-title').focus();
  }

  function checklist(checkedIds) {
    const box = $('access-checklist');
    box.innerHTML = '';
    for (const d of state.catalog) {
      if (!d.subjects.length) continue;
      const boxes = d.subjects.map((s) =>
        h('div', { class: 'check' },
          h('input', { type: 'checkbox', id: `acc-${s.id}`, value: s.id, checked: checkedIds.has(s.id) }),
          h('label', { for: `acc-${s.id}` }, s.name))
      );
      const toggleAll = h('button', {
        type: 'button',
        class: 'link small-text',
        onclick: () => {
          const inputs = boxes.map((b) => b.querySelector('input'));
          const allOn = inputs.every((i) => i.checked);
          inputs.forEach((i) => (i.checked = !allOn));
        },
      }, 'Toggle all');
      box.append(h('fieldset', {}, h('legend', {}, d.name, ' ', toggleAll), boxes));
    }
  }
  const checkedSubjects = () => [...$('access-checklist').querySelectorAll('input:checked')].map((i) => Number(i.value));

  function renderAccessPanel() {
    const panel = $('access-panel');
    const actions = $('access-actions');
    actions.innerHTML = '';
    const student = state.students.find((s) => s.id === state.editing);
    $('access-title').setAttribute('tabindex', '-1');

    if (student) {
      panel.hidden = false;
      $('access-title').textContent = `AI teachers for ${student.displayName}`;
      $('access-help').textContent = 'The student can only use the checked teachers. Unchecking a teacher locks existing chats with that teacher.';
      checklist(new Set(student.subjectIds));
      actions.append(
        h('button', { class: 'secondary', onclick: () => { state.editing = null; renderStudents(); renderAccessPanel(); } }, 'Close'),
        h('button', {
          class: 'primary',
          onclick: () => run(async () => {
            await api('PUT', `/admin/students/${student.id}/subjects`, { subjectIds: checkedSubjects() });
            await loadStudents();
          }, 'Access saved.'),
        }, 'Save access')
      );
    } else if (state.selected.size) {
      panel.hidden = false;
      $('access-title').textContent = `Bulk change for ${state.selected.size} selected student(s)`;
      $('access-help').textContent = 'Check the teachers to grant or revoke. Other teachers are left unchanged.';
      checklist(new Set());
      const bulk = (mode) => run(async () => {
        const subjectIds = checkedSubjects();
        if (!subjectIds.length) throw new Error('Check at least one teacher first.');
        await api('POST', '/admin/students/bulk-subjects', { studentIds: [...state.selected], subjectIds, mode });
        await loadStudents();
      }, mode === 'add' ? 'Access granted.' : 'Access revoked.');
      actions.append(
        h('button', { class: 'danger', onclick: () => bulk('remove') }, 'Revoke from selected'),
        h('button', { class: 'primary', onclick: () => bulk('add') }, 'Grant to selected')
      );
    } else {
      panel.hidden = true;
    }
  }

  // ---------------------------------------------------------------- Domains & subjects
  function subjectFields(subject, domainId) {
    return [
      { name: 'name', label: 'Subject name', value: subject?.name, required: true, maxlength: 100 },
      { name: 'icon', label: 'Logo', type: 'icon', value: subject?.icon, help: 'Technology or company logo shown to students. Start typing to search, e.g. "python" or "cisco". Logos from simpleicons.org.' },
      { name: 'teacherName', label: 'AI teacher name', value: subject?.teacherName, maxlength: 100, help: 'Shown to students. Leave empty for "<Subject> Tutor".' },
      {
        name: 'domainId',
        label: 'Domain',
        type: 'select',
        value: String(subject?.domainId ?? domainId),
        options: state.catalog.map((d) => ({ value: String(d.id), label: d.name })),
      },
      { name: 'description', label: 'What this subject covers', type: 'textarea', value: subject?.description, maxlength: 1000, help: 'Given to the AI to define the scope of this teacher.' },
      { name: 'keywords', label: 'Keywords (comma-separated)', type: 'textarea', value: subject?.keywords, maxlength: 2000, help: 'Words and phrases typical for this subject, e.g. "sql, join, primary key".' },
    ];
  }

  function renderCatalog() {
    const box = $('catalog');
    if (!box) return;
    box.innerHTML = '';
    const count = allSubjects().length;
    box.append(h('p', { class: 'muted' }, `${state.catalog.length} domains · ${count} subjects`));
    for (const d of state.catalog) {
      box.append(
        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('h2', {}, d.name, h('span', { class: 'muted count' }, ` (${d.subjects.length})`)),
            h('div', { class: 'row-actions' },
              h('button', { class: 'primary small', onclick: () => addSubject(d) }, '+ Add subject'),
              h('button', { class: 'secondary small', onclick: () => renameDomain(d) }, 'Rename'),
              h('button', { class: 'danger small', onclick: () => deleteDomain(d) }, 'Delete domain'))),
          d.subjects.length
            ? h('ul', { class: 'item-list' }, d.subjects.map((s) =>
                h('li', {},
                  iconTile(s.icon, s.name),
                  h('div', { class: 'item-main' },
                    h('strong', {}, s.name), h('span', { class: 'muted' }, ` · ${s.teacherName}`),
                    s.description ? h('div', { class: 'small-text' }, s.description) : null,
                    s.keywords ? h('div', { class: 'muted small-text keywords' }, `Keywords: ${s.keywords}`) : null),
                  h('div', { class: 'row-actions' },
                    h('button', { class: 'secondary small', onclick: () => editSubject(s) }, 'Edit'),
                    h('button', { class: 'danger small', onclick: () => deleteSubject(s) }, 'Delete')))))
            : h('p', { class: 'muted' }, 'No subjects in this domain yet.')
        )
      );
    }
  }

  $('add-domain').onclick = async () => {
    const v = await formDialog({ title: 'Add domain', fields: [{ name: 'name', label: 'Domain name', required: true, maxlength: 100 }], submitLabel: 'Add' });
    if (v) run(async () => { await api('POST', '/admin/domains', v); await loadCatalog(); }, 'Domain added.');
  };

  async function renameDomain(d) {
    const v = await formDialog({ title: 'Rename domain', fields: [{ name: 'name', label: 'Domain name', value: d.name, required: true, maxlength: 100 }] });
    if (v) run(async () => { await api('PATCH', `/admin/domains/${d.id}`, v); await loadCatalog(); }, 'Domain renamed.');
  }

  function deleteDomain(d) {
    const msg = d.subjects.length
      ? `Delete the domain "${d.name}" and its ${d.subjects.length} subject(s)? All student conversations with those AI teachers will be deleted. Prompt history is kept.`
      : `Delete the domain "${d.name}"?`;
    if (!confirm(msg)) return;
    run(async () => { await api('DELETE', `/admin/domains/${d.id}`); await loadCatalog(); }, 'Domain deleted.');
  }

  async function addSubject(d) {
    const v = await formDialog({ title: `Add subject to ${d.name}`, fields: subjectFields(null, d.id), submitLabel: 'Add' });
    if (v) run(async () => { await api('POST', '/admin/subjects', v); await loadCatalog(); }, 'Subject added.');
  }

  async function editSubject(s) {
    const v = await formDialog({ title: `Edit ${s.name}`, fields: subjectFields(s) });
    if (v) run(async () => { await api('PATCH', `/admin/subjects/${s.id}`, v); await loadCatalog(); }, 'Subject saved.');
  }

  function deleteSubject(s) {
    if (!confirm(`Delete the subject "${s.name}"? Student access and conversations with ${s.teacherName} will be deleted. Prompt history is kept.`)) return;
    run(async () => { await api('DELETE', `/admin/subjects/${s.id}`); await loadCatalog(); }, 'Subject deleted.');
  }

  // ---------------------------------------------------------------- Restrictions
  function restrictionFields(r, kind) {
    const isQ = (r?.kind || kind) === 'question';
    return [
      {
        name: 'description',
        label: isQ ? 'Type of question not to answer' : 'Information never to include',
        type: 'textarea',
        value: r?.description,
        required: true,
        maxlength: 500,
        help: isQ ? 'e.g. "Answers to current exam or homework questions"' : 'e.g. "Working malware or attack code aimed at real systems"',
      },
      {
        name: 'keywords',
        label: 'Blocked keywords (optional, comma-separated)',
        type: 'textarea',
        value: r?.keywords,
        maxlength: 2000,
        help: isQ ? 'Questions containing any of these are refused automatically.' : 'Answers containing any of these are stopped and replaced.',
      },
      { name: 'active', label: 'Active', type: 'checkbox', value: r ? r.active : true },
    ];
  }

  async function loadRestrictions() {
    const { restrictions } = await api('GET', '/admin/restrictions');
    for (const kind of ['question', 'response']) {
      const list = $(`restrictions-${kind}`);
      list.innerHTML = '';
      const items = restrictions.filter((r) => r.kind === kind);
      if (!items.length) list.append(h('li', { class: 'muted' }, 'None yet.'));
      for (const r of items) {
        list.append(
          h('li', { class: r.active ? '' : 'inactive' },
            h('div', { class: 'item-main' },
              h('div', {}, r.description, r.active ? null : h('span', { class: 'badge off' }, 'Inactive')),
              r.keywords ? h('div', { class: 'muted small-text keywords' }, `Blocked keywords: ${r.keywords}`) : null),
            h('div', { class: 'row-actions' },
              h('button', {
                class: 'secondary small',
                onclick: async () => {
                  const v = await formDialog({ title: 'Edit restriction', fields: restrictionFields(r) });
                  if (v) run(async () => { await api('PATCH', `/admin/restrictions/${r.id}`, { ...v, kind: r.kind }); await loadRestrictions(); }, 'Restriction saved.');
                },
              }, 'Edit'),
              h('button', {
                class: 'danger small',
                onclick: () => confirm('Delete this restriction?') &&
                  run(async () => { await api('DELETE', `/admin/restrictions/${r.id}`); await loadRestrictions(); }, 'Restriction deleted.'),
              }, 'Delete')))
        );
      }
    }
  }

  document.querySelectorAll('[data-add-restriction]').forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.dataset.addRestriction;
      const v = await formDialog({ title: kind === 'question' ? 'Add question restriction' : 'Add response restriction', fields: restrictionFields(null, kind), submitLabel: 'Add' });
      if (v) run(async () => { await api('POST', '/admin/restrictions', { ...v, kind }); await loadRestrictions(); }, 'Restriction added.');
    };
  });

  // ---------------------------------------------------------------- Goals
  async function loadGoals() {
    const { goals } = await api('GET', '/admin/goals');
    const list = $('goal-list');
    list.innerHTML = '';
    if (!goals.length) list.append(h('li', { class: 'muted' }, 'No learning goals yet.'));
    for (const g of goals) {
      list.append(
        h('li', { class: g.active ? '' : 'inactive' },
          h('div', { class: 'item-main' }, g.text, g.active ? null : h('span', { class: 'badge off' }, 'Inactive')),
          h('div', { class: 'row-actions' },
            h('button', {
              class: 'secondary small',
              onclick: async () => {
                const v = await formDialog({
                  title: 'Edit learning goal',
                  fields: [
                    { name: 'text', label: 'Goal', type: 'textarea', value: g.text, required: true, maxlength: 1000 },
                    { name: 'active', label: 'Active (included in prompts)', type: 'checkbox', value: g.active },
                  ],
                });
                if (v) run(async () => { await api('PATCH', `/admin/goals/${g.id}`, v); await loadGoals(); }, 'Goal saved.');
              },
            }, 'Edit'),
            h('button', {
              class: 'danger small',
              onclick: () => confirm('Delete this learning goal?') &&
                run(async () => { await api('DELETE', `/admin/goals/${g.id}`); await loadGoals(); }, 'Goal deleted.'),
            }, 'Delete')))
      );
    }
  }

  $('goal-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('goal-text').value.trim();
    if (!text) return;
    run(async () => {
      await api('POST', '/admin/goals', { text });
      $('goal-text').value = '';
      await loadGoals();
    }, 'Goal added.');
  };

  // ---------------------------------------------------------------- Prompt history
  async function fillPromptFilters() {
    if (!state.students.length) state.students = (await api('GET', '/admin/students')).students;
    if (!state.catalog.length) await loadCatalog();
    const fillSelect = (sel, items, label) => {
      const current = sel.value;
      sel.innerHTML = '';
      sel.append(h('option', { value: '' }, label), items.map((i) => h('option', { value: String(i.id) }, i.label)));
      sel.value = current;
    };
    fillSelect($('f-student'), state.students.map((s) => ({ id: s.id, label: `${s.displayName} (${s.email})` })), 'All students');
    fillSelect($('f-subject'), allSubjects().map((s) => ({ id: s.id, label: s.name })), 'All subjects');
  }

  function promptQuery() {
    const p = new URLSearchParams();
    if ($('f-student').value) p.set('studentId', $('f-student').value);
    if ($('f-subject').value) p.set('subjectId', $('f-subject').value);
    if ($('f-from').value) p.set('from', $('f-from').value);
    if ($('f-to').value) p.set('to', $('f-to').value);
    if ($('f-flagged').checked) p.set('flagged', 'true');
    return p;
  }

  const FLAG_LABELS = { wellbeing: 'Wellbeing concern', restricted: 'Restricted topic' };

  async function loadPrompts() {
    const p = promptQuery();
    if ($('f-q').value.trim()) p.set('q', $('f-q').value.trim());
    p.set('limit', state.prompts.limit);
    p.set('offset', state.prompts.offset);
    const data = await api('GET', `/admin/prompts?${p}`);
    state.prompts.total = data.total;
    const tbody = $('prompt-rows');
    tbody.innerHTML = '';
    if (!data.prompts.length) tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'No prompts match these filters.')));
    for (const r of data.prompts) {
      tbody.append(
        h('tr', { class: r.flag ? 'flagged' : '' },
          h('td', { class: 'small-text nowrap' }, fmt(r.createdAt)),
          h('td', {}, h('strong', {}, r.studentName), h('div', { class: 'muted small-text' }, r.studentEmail)),
          h('td', { class: 'small-text' }, r.subjectName),
          h('td', { class: 'prompt-text' }, r.content),
          h('td', {}, r.flag ? h('span', { class: `badge ${r.flag === 'wellbeing' ? 'alert' : 'warn'}` }, FLAG_LABELS[r.flag] || r.flag) : ''),
          h('td', {}, h('button', {
            class: 'danger small',
            'aria-label': 'Delete this prompt',
            onclick: () => confirm('Delete this prompt from the history?') &&
              run(async () => { await api('DELETE', `/admin/prompts/${r.id}`); await loadPrompts(); }, 'Prompt deleted.'),
          }, 'Delete')))
      );
    }
    const { offset, limit, total } = state.prompts;
    $('prompt-count').textContent = `${total} prompt(s)`;
    $('page-info').textContent = total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '';
    $('prev-page').disabled = offset === 0;
    $('next-page').disabled = offset + limit >= total;
  }

  $('prompt-filters').onsubmit = (e) => {
    e.preventDefault();
    state.prompts.offset = 0;
    run(loadPrompts);
  };
  $('f-reset').onclick = () => {
    $('prompt-filters').reset();
    state.prompts.offset = 0;
    run(loadPrompts);
  };
  $('prev-page').onclick = () => {
    state.prompts.offset = Math.max(0, state.prompts.offset - state.prompts.limit);
    run(loadPrompts);
  };
  $('next-page').onclick = () => {
    state.prompts.offset += state.prompts.limit;
    run(loadPrompts);
  };

  $('delete-filtered').onclick = () => {
    const p = promptQuery();
    if (![...p.keys()].length) return alert('Choose a student, subject, date range or "flagged only" first. Use "Delete all history" to delete everything.');
    if ($('f-q').value.trim()) return alert('Text search cannot be used for bulk deletion. Clear the search box, or delete entries one by one.');
    if (!confirm('Permanently delete all prompt history matching the current filters?')) return;
    run(async () => {
      const { deleted } = await api('DELETE', `/admin/prompts?${p}`);
      state.prompts.offset = 0;
      await loadPrompts();
      announce(`${deleted} prompt(s) deleted.`);
    });
  };

  $('delete-all').onclick = async () => {
    const v = await formDialog({
      title: 'Delete all prompt history?',
      submitLabel: 'Delete everything',
      fields: [{ name: 'confirm', label: 'This permanently deletes the history of ALL students. Type DELETE to confirm.', required: true }],
    });
    if (v?.confirm !== 'DELETE') return;
    run(async () => {
      const { deleted } = await api('DELETE', '/admin/prompts?all=true');
      state.prompts.offset = 0;
      await loadPrompts();
      announce(`${deleted} prompt(s) deleted.`);
    });
  };

  // ---------------------------------------------------------------- Settings
  async function loadSettings() {
    const [status, { admins }] = await Promise.all([api('GET', '/admin/status'), api('GET', '/admin/admins')]);
    const lm = status.ollama;
    const dl = $('status');
    dl.innerHTML = '';
    const row = (k, v) => dl.append(h('dt', {}, k), h('dd', {}, v));
    row('Ollama address', status.ollamaUrl);
    row('Model', status.model);
    row('Connection', lm.ok ? h('span', { class: 'badge ok' }, 'Connected') : h('span', { class: 'badge alert' }, `Not reachable: ${lm.error}. Start Ollama on the server computer.`));
    if (lm.ok) {
      row('Model installed', lm.modelInstalled
        ? h('span', { class: 'badge ok' }, 'Yes')
        : h('span', { class: 'badge warn' }, `No. Run "ollama pull ${status.model}" on the server. Installed: ${lm.models.join(', ') || 'none'}`));
    }

    const list = $('admin-list');
    list.innerHTML = '';
    for (const a of admins) {
      list.append(
        h('li', {},
          h('div', { class: 'item-main' }, h('strong', {}, a.displayName), h('span', { class: 'muted' }, ` · ${a.email}`),
            h('div', { class: 'muted small-text' }, `Last sign-in: ${fmt(a.lastLoginAt)}`)),
          a.id === state.user.id
            ? h('span', { class: 'muted small-text' }, 'You')
            : h('button', {
                class: 'danger small',
                onclick: () => confirm(`Remove teacher account ${a.email}?`) &&
                  run(async () => { await api('DELETE', `/admin/admins/${a.id}`); await loadSettings(); }, 'Teacher removed.'),
              }, 'Remove'))
      );
    }
  }
  $('refresh-status').onclick = () => run(loadSettings);

  $('add-admin').onclick = async () => {
    const v = await formDialog({
      title: 'Add teacher account',
      submitLabel: 'Create',
      fields: [
        { name: 'displayName', label: 'Name', maxlength: 80 },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'password', label: 'Initial password (at least 10 characters)', type: 'password', required: true },
      ],
    });
    if (v) run(async () => { await api('POST', '/admin/admins', v); await loadSettings(); }, 'Teacher account created.');
  };

  // ---------------------------------------------------------------- Start
  $('auth-view').hidden = false;
  $('login-email').focus();
})();
