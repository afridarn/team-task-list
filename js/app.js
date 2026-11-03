'use strict';
(() => {
  const { $, h, toast, daysLeft, isOpen, isLate, fmtDate, fmtDateTime, dueInfo, statusBadge, prioBadge, progressBar,
    dialog, field, STATUSES, PRIORITIES } = TH.ui;
  const cfg = window.TASKHUB_CONFIG || {};

  const state = {
    user: null, users: [], tasks: [], view: 'dashboard', showAllDone: false, sig: '',
    f: { q: '', assignee: '', priority: '', type: '', mine: false, overdue: false, hideDone: false },
    sort: { key: 'deadline', dir: 1 },
    wsort: { key: 'name', dir: 1 },
  };
  let contentEl = null;
  let timers = [];

  // ----------------------------------------------------------------- data
  const userName = (id) => { const u = state.users.find((x) => x.id === id); return u ? u.display_name : '—'; };
  const canEdit = (t) => state.user.role === 'admin' || t.assignee_id === state.user.id || t.created_by === state.user.id;
  const isAdmin = () => state.user.role === 'admin';

  const normTask = (t) => ({ ...t, deadline: t.deadline ? String(t.deadline).slice(0, 16) : null,
    assignee_name: t.assignee_id ? userName(t.assignee_id) : '' });
  const signature = (tasks, users) => tasks.map((t) => t.id + ':' + t.updated_at).join('|') + '#' + users.map((u) => u.id + u.role + u.active + u.display_name).join('|');

  function applyData(users, tasks) {
    state.users = users;
    state.tasks = tasks.map(normTask);
    state.sig = signature(tasks, users);
  }
  async function loadAll() {
    const [users, tasks] = await Promise.all([TH.supa.profiles(), TH.supa.tasks()]);
    applyData(users, tasks);
  }
  async function refresh() { await loadAll(); drawContent(); }

  // ------------------------------------------------------- setup / login
  function centerCard(...kids) { $('#app').replaceChildren(h('div', { class: 'center-card' }, h('div', { class: 'login' }, ...kids))); }

  function renderSetupNeeded() {
    centerCard(h('h1', { text: 'Setup needed' }),
      h('p', { text: 'config.js still contains placeholder values. Open config.js and paste your Supabase Project URL and publishable key, then reload this page.' }));
  }

  function renderLogin(message) {
    stopTimers();
    state.user = null;
    const err = h('div', { class: 'err', role: 'alert', text: message || '' });
    const email = h('input', { type: 'text', id: 'le', autocomplete: 'username', inputMode: 'email', required: true, autofocus: true });
    const pass = h('input', { type: 'password', id: 'lp', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; err.textContent = '';
        try { await TH.supa.signIn(email.value, pass.value); await boot(); }
        catch (ex) { err.textContent = ex.message; pass.value = ''; }
        btn.disabled = false;
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'le', text: 'Email' }), email),
    h('div', { class: 'field' }, h('label', { for: 'lp', text: 'Password' }), pass), err, btn);
    $('#app').replaceChildren(h('div', { class: 'login-wrap' }, h('div', { class: 'login' },
      h('h1', {}, 'INAP ', h('span', { class: 'muted', text: 'Task Hub' })),
      h('p', { text: 'Sign in with your team account.' }), form)));
  }

  function renderPending() {
    centerCard(h('h1', { text: 'Waiting for activation' }),
      h('p', { text: 'Your account (' + state.user.email + ') exists but has not been activated yet. Ask an admin to activate it in the Users tab, then check again.' }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', text: 'Check again', onclick: () => boot().catch((e) => renderLogin(e.message)) }),
        h('button', { class: 'btn', text: 'Sign out', onclick: signOut })));
  }

  async function signOut() { stopTimers(); await TH.supa.signOut(); renderLogin(); }

  async function boot() {
    const me = await TH.supa.me();
    if (!me) throw new Error('This account has no profile yet. Run supabase/schema.sql, or ask an admin.');
    state.user = me;
    if (!me.active) { renderPending(); return; }
    await loadAll();
    renderApp();
    startTimers();
  }

  // -------------------------------------------- idle sign-out + auto refresh
  function stopTimers() { timers.forEach(clearInterval); timers = []; }
  function startTimers() {
    stopTimers();
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    for (const ev of ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']) window.addEventListener(ev, bump, { passive: true });
    const idleMs = (cfg.IDLE_MINUTES || 30) * 60000;
    timers.push(setInterval(() => { if (state.user && Date.now() - last > idleMs) { stopTimers(); TH.supa.signOut().then(() => renderLogin('You were signed out after being idle.')); } }, 20000));
    const poll = async () => {
      if (!state.user || document.visibilityState !== 'visible') return;
      try {
        const [users, tasks] = await Promise.all([TH.supa.profiles(), TH.supa.tasks()]);
        if (signature(tasks, users) !== state.sig) { applyData(users, tasks); drawContent(); }
      } catch (e) { /* transient network error: try again later */ }
    };
    timers.push(setInterval(poll, 45000));
    document.addEventListener('visibilitychange', poll);
  }

  // ---------------------------------------------------------------- shell
  function setView(v) { state.view = v; renderApp(); }

  function renderApp() {
    const admin = isAdmin();
    const tabs = [['dashboard', 'Dashboard'], ['board', 'Board'], ['table', 'Tasks']];
    if (admin) tabs.push(['users', 'Users'], ['audit', 'Audit log']);
    const nav = h('nav', { class: 'nav' }, tabs.map(([k, l]) =>
      h('button', { text: l, 'aria-current': state.view === k ? 'page' : null, onclick: () => setView(k) })));
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, 'INAP ', h('span', { text: 'Task Hub' })), nav, h('div', { class: 'spacer' }),
      h('button', { class: 'btn primary', text: '+ New task', onclick: () => openTask(null) }),
      h('span', { class: 'who', text: state.user.display_name + (admin ? ' (admin)' : '') }),
      h('button', { class: 'btn small', text: 'Password', onclick: passwordDialog }),
      h('button', { class: 'btn small', text: 'Sign out', onclick: signOut }));
    $('#app').replaceChildren(top, h('main', { id: 'main' }));
    mountView();
  }

  function mountView() {
    const main = $('#main');
    main.replaceChildren();
    if (state.view === 'board' || state.view === 'table') main.append(filtersBar());
    contentEl = h('div');
    main.append(contentEl);
    drawContent();
  }

  function drawContent() {
    if (!contentEl) return;
    const views = { dashboard: dashboardView, board: boardView, table: tableView, users: usersView, audit: auditView };
    contentEl.replaceChildren(views[state.view]());
  }

  // -------------------------------------------------------------- filters
  function visibleTasks() {
    const f = state.f, q = f.q.trim().toLowerCase();
    return state.tasks.filter((t) => {
      if (f.assignee && t.assignee_id !== f.assignee) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.type && t.task_type !== f.type) return false;
      if (f.mine && t.assignee_id !== state.user.id) return false;
      if (f.overdue && !isLate(t)) return false;
      if (f.hideDone && !isOpen(t)) return false;
      if (q && ![t.title, t.task_type, t.domain, t.customer_pic, t.assignee_name, t.summary, t.notes].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function filtersBar() {
    const f = state.f;
    const types = [...new Set(state.tasks.map((t) => t.task_type).filter(Boolean))].sort();
    const sel = (key, all, opts) => h('select', { 'aria-label': all, value: f[key], onchange: (e) => { f[key] = e.target.value; drawContent(); } },
      h('option', { value: '', text: all }), opts.map(([v, l]) => h('option', { value: v, text: l })));
    const chk = (key, label) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: f[key], onchange: (e) => { f[key] = e.target.checked; drawContent(); } }), label);
    return h('div', { class: 'filters' },
      h('input', { type: 'text', placeholder: 'Search tasks…', 'aria-label': 'Search', value: f.q, oninput: (e) => { f.q = e.target.value; drawContent(); } }),
      sel('assignee', 'All assignees', state.users.filter((u) => u.active || state.tasks.some((t) => t.assignee_id === u.id)).map((u) => [u.id, u.display_name])),
      sel('priority', 'All priorities', PRIORITIES.map((p) => [p, p])),
      sel('type', 'All types', types.map((t) => [t, t])),
      chk('mine', 'Mine only'), chk('overdue', 'Overdue only'), chk('hideDone', 'Hide finished'),
      h('button', { class: 'btn small', text: 'Clear', onclick: () => {
        Object.assign(f, { q: '', assignee: '', priority: '', type: '', mine: false, overdue: false, hideDone: false });
        mountView();
      } }));
  }

  // ------------------------------------------------------------ dashboard
  function bar(p, w, d) {
    const total = p + w + d || 1;
    const seg = (cls, n) => { const i = h('i', { class: cls, title: String(n) }); i.style.width = (n / total * 100) + '%'; return i; };
    return h('div', { class: 'bar' }, seg('b-done', d), seg('b-work', w), seg('b-pending', p));
  }

  function dashboardView() {
    const T = state.tasks, open = T.filter(isOpen);
    const cnt = (a, fn) => a.filter(fn).length;
    const finished = T.length - open.length;
    const pct = T.length ? Math.round(finished / T.length * 100) : 0;
    const tile = (n, l, alert) => h('div', { class: 'tile' + (alert && n ? ' alert' : '') }, h('div', { class: 'num', text: String(n) }), h('div', { class: 'lbl', text: l }));

    const people = state.users.filter((u) => u.active || T.some((t) => t.assignee_id === u.id))
      .map((u) => ({ id: u.id, name: u.display_name, tasks: T.filter((t) => t.assignee_id === u.id) }));
    const none = T.filter((t) => t.assignee_id == null);
    if (none.length) people.push({ id: null, name: 'Unassigned', tasks: none });
    const rows = people.map((p) => {
      const a = p.tasks, o = a.filter(isOpen), fi = cnt(a, (t) => t.status === 'Finished');
      return { id: p.id, name: p.name, pending: cnt(a, (t) => t.status === 'Pending'), work: cnt(a, (t) => t.status === 'On Work'), finished: fi,
        total: a.length, overdue: cnt(a, isLate), pct: a.length ? fi / a.length : 0,
        high: cnt(o, (t) => t.priority === 'High'), med: cnt(o, (t) => t.priority === 'Medium'), low: cnt(o, (t) => t.priority === 'Low') };
    });
    const ws = state.wsort;
    rows.sort((x, y) => {
      const a = x[ws.key], b = y[ws.key];
      const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
      return (c * ws.dir) || x.name.localeCompare(y.name);
    });

    const heads = [['name', 'Assignee'], ['pending', 'Pending'], ['work', 'On Work'], ['finished', 'Finished'], ['total', 'Total'],
      ['overdue', 'Overdue'], ['pct', '% Done'], ['high', 'Open High'], ['med', 'Open Med'], ['low', 'Open Low']];
    const th = heads.map(([k, l]) => h('th', {
      class: 'sortable' + (k !== 'name' ? ' num' : ''), tabindex: '0', role: 'columnheader',
      'aria-sort': ws.key === k ? (ws.dir > 0 ? 'ascending' : 'descending') : 'none',
      text: l + (ws.key === k ? (ws.dir > 0 ? ' ▲' : ' ▼') : ''),
      onclick: () => { state.wsort = { key: k, dir: ws.key === k ? -ws.dir : (k === 'name' ? 1 : -1) }; drawContent(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.click(); },
    }));

    const attention = open.filter((t) => t.deadline && daysLeft(t) <= 3)
      .sort((a, b) => daysLeft(a) - daysLeft(b) || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)).slice(0, 15);

    return h('div', {},
      h('div', { class: 'tiles' }, tile(T.length, 'Total'), tile(open.length, 'Open'), tile(cnt(T, (t) => t.status === 'On Work'), 'On Work'),
        tile(cnt(T, (t) => t.status === 'Pending'), 'Pending'), tile(finished, 'Finished'), tile(cnt(open, isLate), 'Overdue', true), tile(pct + '%', '% Complete')),
      h('section', { class: 'panel' }, h('h2', { text: 'Team workload (click a column to sort)' }), h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, th, h('th', { text: 'Distribution' }))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.id ? 'click' : '', onclick: r.id ? () => { Object.assign(state.f, { assignee: r.id, hideDone: true }); setView('table'); } : null },
          h('td', { text: r.name }), h('td', { class: 'num', text: String(r.pending) }), h('td', { class: 'num', text: String(r.work) }),
          h('td', { class: 'num', text: String(r.finished) }), h('td', { class: 'num', text: String(r.total) }),
          h('td', { class: 'num' + (r.overdue ? ' late' : ''), text: String(r.overdue) }), h('td', { class: 'num', text: r.total ? Math.round(r.pct * 100) + '%' : '—' }),
          h('td', { class: 'num', text: String(r.high) }), h('td', { class: 'num', text: String(r.med) }), h('td', { class: 'num', text: String(r.low) }),
          h('td', {}, bar(r.pending, r.work, r.finished))))))),
        h('p', { class: 'hint dlg-body', text: 'Click a person to see their open tasks.' })),
      h('section', { class: 'panel' }, h('h2', { text: 'Needs attention (overdue or due within 3 days)' }),
        attention.length ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Task', 'Assignee', 'Priority', 'Status', 'Deadline'].map((l) => h('th', { text: l })))),
          h('tbody', {}, attention.map((t) => { const d = dueInfo(t); return h('tr', { class: 'click', onclick: () => openTask(t) },
            h('td', { class: 'titlecell', text: t.title }), h('td', { text: t.assignee_name || '—' }), h('td', {}, prioBadge(t.priority)),
            h('td', {}, statusBadge(t.status)), h('td', { class: d.cls, text: d.text })); })))) : h('p', { class: 'muted dlg-body', text: 'Nothing urgent right now.' })));
  }

  // ---------------------------------------------------------------- board
  function boardView() {
    const tasks = visibleTasks();
    const wrap = h('div', { class: 'board' });
    for (const s of STATUSES) {
      const list = tasks.filter((t) => t.status === s);
      if (s === 'Finished') list.sort((a, b) => (b.finished_at || '').localeCompare(a.finished_at || ''));
      else list.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (a.deadline || '9').localeCompare(b.deadline || '9'));
      const shown = s === 'Finished' && !state.showAllDone ? list.slice(0, 10) : list;
      const col = h('section', { class: 'col', dataset: { status: s } },
        h('h3', {}, h('span', { text: s }), h('span', { class: 'muted', text: String(list.length) })), shown.map(card));
      if (s === 'Finished' && list.length > 10) {
        col.append(h('button', { class: 'btn small more', text: state.showAllDone ? 'Show latest 10' : 'Show all ' + list.length,
          onclick: () => { state.showAllDone = !state.showAllDone; drawContent(); } }));
      }
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const t = state.tasks.find((x) => String(x.id) === e.dataTransfer.getData('text/plain'));
        if (t && t.status !== s) await saveTask(t.id, { status: s });
      });
      wrap.append(col);
    }
    return wrap;
  }

  function card(t) {
    const d = dueInfo(t);
    const el = h('article', {
      class: 'card pr-' + t.priority, draggable: canEdit(t), tabindex: '0', role: 'button', 'aria-label': t.title,
      onclick: () => openTask(t), onkeydown: (e) => { if (e.key === 'Enter') openTask(t); },
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', String(t.id)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); },
      ondragend: () => el.classList.remove('dragging'),
    },
    h('div', { class: 't', text: t.title }),
    h('div', {}, t.task_type && h('span', { class: 'chip', text: t.task_type }), t.domain && h('span', { class: 'chip', text: t.domain }),
      t.customer_pic && h('span', { class: 'chip', text: 'PIC: ' + t.customer_pic })),
    t.status !== 'Finished' && t.progress > 0 && progressBar(t.progress),
    h('div', { class: 'meta' }, h('span', { text: t.assignee_name || 'Unassigned' }), h('span', { class: d.cls, text: d.text })));
    return el;
  }

  async function saveTask(id, patch) {
    try {
      const t = normTask(await TH.supa.updateTask(id, patch));
      state.tasks = state.tasks.map((x) => (x.id === id ? t : x));
      drawContent();
    } catch (e) { toast(e.message, true); await refresh().catch(() => {}); }
  }

  // ---------------------------------------------------------------- table
  function tableView() {
    const cols = [
      { k: 'id', l: '#', cls: 'num', v: (t) => t.id, cell: (t) => h('td', { class: 'num muted', text: String(t.id) }) },
      { k: 'title', l: 'Task', v: (t) => t.title.toLowerCase(), cell: (t) => h('td', { class: 'titlecell' }, h('div', { text: t.title }),
        h('div', {}, t.task_type && h('span', { class: 'chip', text: t.task_type }), t.domain && h('span', { class: 'chip', text: t.domain }))) },
      { k: 'assignee', l: 'Assignee', v: (t) => (t.assignee_name || '~').toLowerCase(), cell: (t) => h('td', { text: t.assignee_name || '—' }) },
      { k: 'pic', l: 'Customer PIC', v: (t) => t.customer_pic.toLowerCase(), cell: (t) => h('td', { text: t.customer_pic || '—' }) },
      { k: 'status', l: 'Status', v: (t) => STATUSES.indexOf(t.status), cell: (t) => h('td', {}, statusBadge(t.status)) },
      { k: 'progress', l: 'Progress', v: (t) => t.progress, cell: (t) => h('td', {}, h('div', { text: t.progress + '%' }), progressBar(t.progress)) },
      { k: 'priority', l: 'Priority', v: (t) => PRIORITIES.indexOf(t.priority), cell: (t) => h('td', {}, prioBadge(t.priority)) },
      { k: 'deadline', l: 'Deadline', v: (t) => t.deadline || '9999', cell: (t) => { const d = dueInfo(t); return h('td', { class: d.cls, text: d.text }); } },
    ];
    const col = cols.find((c) => c.k === state.sort.key) || cols[7];
    const rows = visibleTasks().sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      return (x < y ? -1 : x > y ? 1 : 0) * state.sort.dir || a.id - b.id;
    });
    const head = cols.map((c) => h('th', {
      class: 'sortable' + (c.cls ? ' ' + c.cls : ''), 'aria-sort': c.k === state.sort.key ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none',
      text: c.l + (c.k === state.sort.key ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''),
      onclick: () => { state.sort = { key: c.k, dir: state.sort.key === c.k ? -state.sort.dir : 1 }; drawContent(); },
    }));
    return h('div', {},
      h('div', { class: 'filters' }, h('span', { class: 'muted', text: rows.length + ' of ' + state.tasks.length + ' tasks' }), h('span', { class: 'spacer' }),
        h('div', { class: 'btn-row' },
          isAdmin() && h('button', { class: 'btn small', id: 'btn-import', text: 'Import from Excel', onclick: () => TH.excel.openImport({ users: state.users, tasks: state.tasks, onDone: refresh }) }),
          h('button', { class: 'btn small', id: 'btn-xlsx', text: 'Export Excel', onclick: () => TH.excel.exportExcel(visibleTasks()) }),
          h('button', { class: 'btn small', id: 'btn-csv', text: 'Export CSV', onclick: () => TH.excel.exportCsv(visibleTasks()) }))),
      h('section', { class: 'panel' }, h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, head)),
        h('tbody', {}, rows.length ? rows.map((t) => h('tr', { class: 'click', onclick: () => openTask(t) }, cols.map((c) => c.cell(t))))
          : h('tr', {}, h('td', { colspan: String(cols.length), class: 'muted', text: 'No tasks match the current filters.' })))))));
  }

  // ------------------------------------------------------------ task form
  const LABELS = { title: 'title', task_type: 'type', domain: 'domain', customer_pic: 'PIC', status: 'status', priority: 'priority',
    progress: 'progress', deadline: 'deadline', summary: 'summary', notes: 'notes', assignee_id: 'assignee' };
  function describeChange(e) {
    if (e.action !== 'task_updated') return e.detail;
    try {
      return Object.entries(JSON.parse(e.detail)).filter(([k]) => LABELS[k]).map(([k, [a, b]]) => {
        if (k === 'assignee_id') { a = a ? userName(a) : 'none'; b = b ? userName(b) : 'none'; }
        if (k === 'summary' || k === 'notes') return LABELS[k] + ' edited';
        if (k === 'deadline') { a = a && a.replace('T', ' ').slice(0, 16); b = b && b.replace('T', ' ').slice(0, 16); }
        return LABELS[k] + ': ' + (a || '∅') + ' → ' + (b || '∅');
      }).join('; ');
    } catch (x) { return e.detail; }
  }

  function openTask(t) {
    const isNew = !t, editable = isNew || canEdit(t);
    t = t || { title: '', task_type: '', domain: '', customer_pic: '', status: 'Pending', priority: 'Medium', progress: 0,
      deadline: '', summary: '', notes: '', assignee_id: state.user.id };
    const f = {};
    f.title = h('input', { type: 'text', maxlength: '300', value: t.title });
    f.type = h('input', { type: 'text', maxlength: '60', list: 'dl-type', value: t.task_type });
    f.domain = h('input', { type: 'text', maxlength: '80', list: 'dl-domain', value: t.domain });
    f.pic = h('input', { type: 'text', maxlength: '200', value: t.customer_pic, placeholder: 'Free text, e.g. NOC team or a person' });
    const people = state.users.filter((u) => u.active || u.id === t.assignee_id);
    f.assignee = h('select', { value: t.assignee_id || '' }, h('option', { value: '', text: 'Unassigned' }),
      people.map((u) => h('option', { value: u.id, text: u.display_name })));
    f.status = h('select', { value: t.status }, STATUSES.map((s) => h('option', { value: s, text: s })));
    f.priority = h('select', { value: t.priority }, PRIORITIES.map((s) => h('option', { value: s, text: s })));
    const pctLabel = h('span', { text: t.progress + '%' });
    f.progress = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(t.progress),
      oninput: () => { pctLabel.textContent = f.progress.value + '%'; } });
    f.status.addEventListener('change', () => { if (f.status.value === 'Finished') { f.progress.value = '100'; pctLabel.textContent = '100%'; } });
    f.deadline = h('input', { type: 'datetime-local', value: t.deadline || '' });
    f.summary = h('textarea', { maxlength: '20000', value: t.summary });
    f.notes = h('textarea', { maxlength: '20000', value: t.notes });
    const err = h('div', { class: 'err', role: 'alert' });
    const history = h('ul', { class: 'history' });
    const dl = (id, vals) => h('datalist', { id }, [...new Set(vals.filter(Boolean))].sort().map((v) => h('option', { value: v })));

    const body = h('div', {},
      dl('dl-type', state.tasks.map((x) => x.task_type)), dl('dl-domain', state.tasks.map((x) => x.domain)),
      !editable && h('p', { class: 'muted', text: 'Read-only: you can edit tasks assigned to you or created by you.' }),
      h('fieldset', { disabled: !editable },
        field('Title', f.title),
        h('div', { class: 'grid3' }, field('Type', f.type), field('Domain', f.domain), field('Customer PIC', f.pic)),
        h('div', { class: 'grid3' }, field('Assignee', f.assignee), field('Status', f.status), field('Priority', f.priority)),
        h('div', { class: 'grid2' }, field('Deadline', f.deadline), h('div', { class: 'field' }, h('label', {}, 'Progress ', pctLabel), f.progress)),
        field('Summary', f.summary), field('Notes', f.notes)),
      !isNew && h('p', { class: 'muted', text: 'Created ' + fmtDateTime(t.created_at) + (t.finished_at ? ' · Finished ' + fmtDateTime(t.finished_at) : '') +
        ' · Last updated ' + fmtDateTime(t.updated_at) + (t.updated_by ? ' by ' + userName(t.updated_by) : '') }),
      !isNew && h('details', {}, h('summary', { text: 'History' }), history), err);

    const save = h('button', { class: 'btn primary', text: isNew ? 'Create task' : 'Save changes', hidden: !editable, onclick: async () => {
      err.textContent = ''; save.disabled = true;
      const payload = { title: f.title.value.trim(), task_type: f.type.value.trim(), domain: f.domain.value.trim(), customer_pic: f.pic.value.trim(),
        assignee_id: f.assignee.value || null, status: f.status.value, priority: f.priority.value, progress: Number(f.progress.value),
        deadline: f.deadline.value || null, summary: f.summary.value, notes: f.notes.value };
      if (!payload.title) { err.textContent = 'Title is required.'; save.disabled = false; return; }
      try {
        if (isNew) await TH.supa.createTask(payload); else await TH.supa.updateTask(t.id, payload);
        dlg.close(); await refresh(); toast(isNew ? 'Task created' : 'Task saved');
      } catch (ex) { err.textContent = ex.message; save.disabled = false; }
    } });
    const del = h('button', { class: 'btn danger left', text: 'Delete', hidden: isNew || !isAdmin(), onclick: async () => {
      if (!window.confirm('Delete this task permanently?')) return;
      try { await TH.supa.deleteTask(t.id); dlg.close(); await refresh(); toast('Task deleted'); }
      catch (ex) { err.textContent = ex.message; }
    } });
    const dlg = dialog(isNew ? 'New task' : 'Task #' + t.id, body, [del, h('button', { class: 'btn', text: 'Cancel', onclick: () => dlg.close() }), save]);
    if (!isNew) {
      TH.supa.history(t.id).then((rows) => {
        history.replaceChildren(...(rows.length ? rows.map((e) => h('li', {
          text: fmtDateTime(e.ts) + ' · ' + (e.username || 'system') + ' · ' + e.action.replace('task_', '') + (describeChange(e) ? ': ' + describeChange(e) : ''),
        })) : [h('li', { text: 'No recorded changes yet.' })]));
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------------- password
  function passwordDialog() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'err', role: 'alert' });
    const ok = h('button', { class: 'btn primary', text: 'Change password', onclick: async () => {
      err.textContent = '';
      if (n1.value.length < 10) { err.textContent = 'New password must be at least 10 characters.'; return; }
      if (n1.value !== n2.value) { err.textContent = 'The new passwords do not match.'; return; }
      if (n1.value === cur.value) { err.textContent = 'New password must differ from the current one.'; return; }
      ok.disabled = true;
      try { await TH.supa.changePassword(cur.value, n1.value); dlg.close(); toast('Password changed'); }
      catch (ex) { err.textContent = ex.message; ok.disabled = false; }
    } });
    const dlg = dialog('Change password', h('div', {}, field('Current password', cur), field('New password (min. 10 characters)', n1), field('Repeat new password', n2), err),
      [h('button', { class: 'btn', text: 'Cancel', onclick: () => dlg.close() }), ok], true);
  }

  // ---------------------------------------------------------- users (admin)
  function usersView() {
    const act = async (id, patch, okMsg) => {
      try { await TH.supa.updateProfile(id, patch); toast(okMsg || 'Saved'); }
      catch (e) { toast(e.message, true); }
      await refresh().catch(() => {});
    };
    const rows = state.users.map((u) => h('tr', {},
      h('td', {}, h('input', { type: 'text', value: u.display_name, maxlength: '80', 'aria-label': 'Display name',
        onchange: (e) => { const v = e.target.value.trim(); if (v) act(u.id, { display_name: v }); else e.target.value = u.display_name; } })),
      h('td', { class: 'muted', text: u.email }),
      h('td', {}, h('select', { 'aria-label': 'Role', value: u.role, onchange: (e) => act(u.id, { role: e.target.value }) },
        h('option', { value: 'member', text: 'member' }), h('option', { value: 'admin', text: 'admin' }))),
      h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: u.active, 'aria-label': 'Active', onchange: (e) => act(u.id, { active: e.target.checked }) }),
        u.active ? 'Active' : 'Not active')),
      h('td', { class: u.active ? 'muted' : 'soon', text: u.active ? '' : 'Waiting for activation' })));
    return h('div', {},
      h('div', { class: 'notice' }, h('b', { text: 'Adding a teammate: ' }),
        'create their login in Supabase (Authentication → Users → Add user), then activate them here. New accounts stay inactive and cannot see any data until you tick "Active".'),
      h('section', { class: 'panel' }, h('h2', { text: 'Team members' }), h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Display name', 'Email (login)', 'Role', 'Access', ''].map((l) => h('th', { text: l })))), h('tbody', {}, rows)))));
  }

  // ---------------------------------------------------------- audit (admin)
  function auditView() {
    const tbody = h('tbody', {}, h('tr', {}, h('td', { colspan: '5', class: 'muted', text: 'Loading…' })));
    TH.supa.audit().then((rows) => {
      tbody.replaceChildren(...rows.map((e) => h('tr', {},
        h('td', { text: fmtDateTime(e.ts) }), h('td', { text: e.username || '—' }), h('td', { text: e.action }),
        h('td', { text: e.task_id ? '#' + e.task_id : '' }), h('td', { class: 'titlecell', text: describeChange(e) }))));
    }).catch((e) => toast(e.message, true));
    return h('section', { class: 'panel' }, h('h2', { text: 'Audit log (latest 500 events)' }), h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Time', 'User', 'Action', 'Task', 'Detail'].map((l) => h('th', { text: l })))), tbody)));
  }

  // ----------------------------------------------------------------- boot
  TH.supa.onSignedOut(() => { stopTimers(); renderLogin('Your session has expired. Please sign in again.'); });
  (async () => {
    if (!TH.supa.configured()) { renderSetupNeeded(); return; }
    if (!TH.supa.hasSession()) { renderLogin(); return; }
    try { await boot(); } catch (e) { renderLogin(e.status === 401 || e.status === 403 ? '' : e.message); }
  })();
})();
