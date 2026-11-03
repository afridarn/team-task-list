'use strict';
/* Export (Excel / CSV) and one-time import from the existing Excel task list. */
window.TH = window.TH || {};
TH.excel = (() => {
  const { h, dialog, field, toast, pad, daysLeft, isOpen, isLate, STATUSES, PRIORITIES } = TH.ui;

  // ---------------------------------------------------------------- helpers
  const wallToSerial = (iso) => {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) / 864e5 + 25569 : null;
  };
  const dateToSerial = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 864e5 + 25569;
  const serialToWall = (n) => {
    if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
    const d = new Date(Math.round((n - 25569) * 1440) * 60000);   // round to the minute
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  };
  const wallToIso = (w) => { const m = w.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).toISOString(); };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };

  function parseWall(v) {                       // cell -> 'YYYY-MM-DDTHH:MM' or null
    if (v == null || v === '') return null;
    if (typeof v === 'number') return serialToWall(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) + 'T' + pad(+(m[4] || 17)) + ':' + (m[5] || '00');
    m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
    if (m && MONTHS[m[2].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[2].toLowerCase()]) + '-' + pad(+m[1]) + 'T' + pad(+(m[4] || 17)) + ':' + (m[5] || '00');
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);   // dd/mm/yyyy
    if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]) + 'T' + pad(+(m[4] || 17)) + ':' + (m[5] || '00');
    return null;
  }

  function parseProgress(v) {
    if (v == null || v === '') return 0;
    let n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', '').replace(',', '.'));
    if (!Number.isFinite(n)) return 0;
    if (typeof v === 'string' && v.includes('%')) return Math.max(0, Math.min(100, Math.round(n)));
    if (n <= 1) n *= 100;                       // Excel stores 70% as 0.7
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };

  // ----------------------------------------------------------------- export
  const HEAD = ['No', 'Task Type', 'Domain', 'Title Detailed', 'Assignee', 'Customer PIC', 'Status', 'Progress', 'Priority',
    'Deadline', 'Days Left', 'Overdue', 'Created', 'Finished', 'Summary', 'Notes'];
  const WIDTH = [6, 14, 20, 52, 28, 18, 11, 10, 10, 19, 10, 9, 19, 19, 60, 60];

  const exportRows = (tasks, forCsv) => tasks.map((t) => {
    const dl = daysLeft(t);
    const dt = (s) => (s ? (forCsv ? pad2(new Date(s)) : { date: dateToSerial(new Date(s)) }) : null);
    return [t.id, t.task_type, t.domain, t.title, t.assignee_name || '', t.customer_pic,
      t.status, forCsv ? t.progress + '%' : { pct: t.progress / 100 }, t.priority,
      t.deadline ? (forCsv ? t.deadline.replace('T', ' ') : { date: wallToSerial(t.deadline) }) : null,
      isOpen(t) && dl !== null ? dl : null, isLate(t) ? 'Yes' : 'No', dt(t.created_at), dt(t.finished_at), t.summary, t.notes];
  });
  const pad2 = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

  function exportExcel(tasks) {
    const cols = HEAD.map((header, i) => ({ header, width: WIDTH[i], wrap: header === 'Summary' || header === 'Notes' }));
    download(TH.xlsx.write('Tasks', cols, exportRows(tasks, false)), 'Task_List_' + stamp() + '.xlsx');
  }

  function toCsv(rows) {
    return rows.map((r) => r.map((c) => {
      let s = c == null ? '' : String(c);
      if (typeof c !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;      // neutralise spreadsheet formulas
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  }
  function exportCsv(tasks) {
    const text = '﻿' + toCsv([HEAD, ...exportRows(tasks, true)]);
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'Task_List_' + stamp() + '.csv');
  }

  // ----------------------------------------------------------------- import
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.map((r) => r.map((x) => (x === '' ? null : x)));
  }

  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const COLS = { task: ['task'], type: ['tasktype', 'type'], domain: ['domain'], title: ['titledetailed', 'title'], assignee: ['assignee'],
    pic: ['customerpic', 'pic'], status: ['status'], progress: ['progress'], priority: ['priority'], deadline: ['deadline'],
    created: ['created'], finished: ['finished'], summary: ['summary'], notes: ['notes'] };
  const STATUS_MAP = { pending: 'Pending', onwork: 'On Work', inprogress: 'On Work', ongoing: 'On Work', finished: 'Finished', done: 'Finished', completed: 'Finished', complete: 'Finished' };
  const PRIO_MAP = { high: 'High', medium: 'Medium', med: 'Medium', low: 'Low' };

  function toTasks(grid) {
    const hi = grid.findIndex((r) => r.some((c) => COLS.title.concat(COLS.task).includes(norm(c))));
    if (hi < 0) throw new Error('Could not find a header row with a "Title Detailed" or "Task" column.');
    const idx = {};
    grid[hi].forEach((c, i) => { const n = norm(c); for (const [k, names] of Object.entries(COLS)) if (idx[k] === undefined && names.includes(n)) idx[k] = i; });
    const get = (r, k) => (idx[k] === undefined ? null : r[idx[k]] ?? null);
    const text = (v) => (v == null ? '' : String(v).trim());
    const warnings = { skipped: 0, status: 0, priority: 0, dates: 0 };
    const tasks = [];
    for (const r of grid.slice(hi + 1)) {
      if (!r.some((c) => c != null && c !== '')) continue;
      let title = text(get(r, 'title'));
      if (!title) { const t = text(get(r, 'task')); title = t.replace(/^\[[^\]]*\]-\[[^\]]*\]-/, '') || t; }
      if (!title) { warnings.skipped++; continue; }
      const st = STATUS_MAP[norm(get(r, 'status'))], pr = PRIO_MAP[norm(get(r, 'priority'))];
      if (!st && text(get(r, 'status'))) warnings.status++;
      if (!pr && text(get(r, 'priority'))) warnings.priority++;
      const dl = parseWall(get(r, 'deadline')), cr = parseWall(get(r, 'created')), fi = parseWall(get(r, 'finished'));
      if (text(get(r, 'deadline')) && !dl) warnings.dates++;
      const status = st || 'Pending';
      tasks.push({ title: title.slice(0, 300), task_type: text(get(r, 'type')).slice(0, 60), domain: text(get(r, 'domain')).slice(0, 80),
        assignee_raw: text(get(r, 'assignee')), customer_pic: text(get(r, 'pic')).slice(0, 200), status,
        progress: status === 'Finished' ? 100 : parseProgress(get(r, 'progress')), priority: pr || 'Medium', deadline: dl,
        created_at: cr ? wallToIso(cr) : null, finished_at: status === 'Finished' && fi ? wallToIso(fi) : null,
        summary: text(get(r, 'summary')).slice(0, 20000), notes: text(get(r, 'notes')).slice(0, 20000) });
    }
    // Make categories consistent: "iWFM" and "IWFM" become whichever spelling is most common.
    for (const key of ['domain', 'task_type']) {
      const counts = {};
      for (const t of tasks) if (t[key]) { const k = t[key].toLowerCase(); (counts[k] = counts[k] || {})[t[key]] = ((counts[k] || {})[t[key]] || 0) + 1; }
      const best = {};
      for (const [k, c] of Object.entries(counts)) best[k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
      for (const t of tasks) if (t[key]) t[key] = best[t[key].toLowerCase()];
    }
    return { tasks, warnings };
  }

  /** Guess which team member an Excel assignee (e.g. "Dina Pratama 84366618") refers to. */
  function guessUser(raw, users) {
    if (!raw) return null;
    const m = raw.match(/^(.*?)\s+(\S*\d\S*)$/);
    const name = norm(m ? m[1] : raw), idTok = m ? m[2].toLowerCase() : '';
    const hit = (fn) => { const f = users.filter(fn); return f.length === 1 ? f[0] : null; };
    return (idTok && hit((u) => u.email.toLowerCase().includes(idTok))) ||
      hit((u) => norm(u.display_name) === name) ||
      hit((u) => name && (norm(u.display_name).includes(name) || name.includes(norm(u.display_name)))) ||
      hit((u) => name && norm(u.email.split('@')[0]) === name);
  }

  async function readFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv') return toTasks(parseCsv(await file.text()));
    if (ext !== 'xlsx') throw new Error('Please choose an .xlsx or .csv file (old .xls files: open in Excel and Save As .xlsx).');
    const sheets = await TH.xlsx.read(await file.arrayBuffer());
    if (!sheets.length) throw new Error('The workbook has no sheets.');
    const sheet = sheets.find((s) => s.name.toLowerCase() === 'tasks') || sheets[0];
    const r = toTasks(sheet.rows);
    r.sheet = sheet.name;
    return r;
  }

  function openImport({ users, tasks, onDone }) {
    const fileInput = h('input', { type: 'file', accept: '.xlsx,.csv' });
    const body = h('div');
    const err = h('div', { class: 'err', role: 'alert' });
    const importBtn = h('button', { class: 'btn primary', text: 'Import', disabled: true });
    let parsed = null, maps = [], modeAdd, modeReplace, skipDup;

    fileInput.addEventListener('change', async () => {
      err.textContent = ''; importBtn.disabled = true; body.replaceChildren();
      const file = fileInput.files[0];
      if (!file) return;
      try { parsed = await readFile(file); } catch (e) { err.textContent = e.message; return; }
      if (!parsed.tasks.length) { err.textContent = 'No tasks were found in this file.'; return; }
      const raws = [...new Set(parsed.tasks.map((t) => t.assignee_raw).filter(Boolean))];
      maps = raws.map((raw) => {
        const g = guessUser(raw, users);
        const sel = h('select', { value: g ? g.id : '' }, h('option', { value: '', text: '— Unassigned —' }),
          users.map((u) => h('option', { value: u.id, text: u.display_name + ' (' + u.email + ')' + (u.active ? '' : ' · inactive') })));
        return { raw, sel, count: parsed.tasks.filter((t) => t.assignee_raw === raw).length, guessed: !!g };
      });
      const w = parsed.warnings, notes = [];
      if (w.skipped) notes.push(w.skipped + ' row(s) without a title will be skipped.');
      if (w.status) notes.push(w.status + ' row(s) have an unrecognised status and will become "Pending".');
      if (w.priority) notes.push(w.priority + ' row(s) have an unrecognised priority and will become "Medium".');
      if (w.dates) notes.push(w.dates + ' row(s) have a deadline that could not be read and will have no deadline.');
      const open = tasks.length > 0;
      modeAdd = h('input', { type: 'radio', name: 'mode', checked: true });
      modeReplace = h('input', { type: 'radio', name: 'mode' });
      skipDup = h('input', { type: 'checkbox', checked: true });
      body.append(
        h('p', {}, 'Found ', h('b', { text: String(parsed.tasks.length) }), ' tasks' + (parsed.sheet ? ' in sheet "' + parsed.sheet + '"' : '') + '.'),
        notes.map((n) => h('div', { class: 'warn', text: n })),
        h('h3', { text: 'Match people' }),
        h('p', { class: 'hint', text: 'Choose which team member each Excel name belongs to. Team members must have an account first.' }),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name in Excel', 'Tasks', 'Team member'].map((l) => h('th', { text: l })))),
          h('tbody', {}, maps.map((m) => h('tr', { class: 'maprow' }, h('td', { text: m.raw }), h('td', { text: String(m.count) }), h('td', {}, m.sel)))))),
        open && h('div', { class: 'field' }, h('h3', { text: 'Existing tasks' }),
          h('label', { class: 'radio' }, modeAdd, h('span', { text: 'Add to the ' + tasks.length + ' existing tasks' })),
          h('label', { class: 'radio check' }, skipDup, h('span', { text: 'Skip rows already present (same title, person and deadline)' })),
          h('label', { class: 'radio' }, modeReplace, h('span', { text: 'Replace: delete all ' + tasks.length + ' existing tasks first' }))));
      importBtn.disabled = false;
    });

    importBtn.addEventListener('click', async () => {
      if (!parsed) return;
      const replace = !!(modeReplace && modeReplace.checked);
      if (replace && !window.confirm('This permanently deletes all ' + tasks.length + ' existing tasks before importing. Continue?')) return;
      importBtn.disabled = true; err.textContent = '';
      const mapOf = Object.fromEntries(maps.map((m) => [m.raw, m.sel.value || null]));
      const key = (t) => [t.title.toLowerCase(), t.assignee_id || '', t.deadline || ''].join('|');
      const existing = new Set(replace ? [] : tasks.map((t) => key({ title: t.title, assignee_id: t.assignee_id, deadline: t.deadline })));
      let rows = parsed.tasks.map(({ assignee_raw, ...t }) => ({ ...t, assignee_id: assignee_raw ? mapOf[assignee_raw] : null }));
      let skipped = 0;
      if (!replace && skipDup && skipDup.checked) rows = rows.filter((t) => { if (existing.has(key(t))) { skipped++; return false; } return true; });
      try {
        if (replace) await TH.supa.deleteAllTasks();
        await TH.supa.bulkInsert(rows, (done, total) => { importBtn.textContent = 'Importing ' + done + '/' + total + '…'; });
        dlg.close();
        toast('Imported ' + rows.length + ' tasks' + (skipped ? ' (' + skipped + ' duplicates skipped)' : ''));
        await onDone();
      } catch (e) { err.textContent = e.message; importBtn.disabled = false; importBtn.textContent = 'Import'; }
    });

    const dlg = dialog('Import tasks from Excel', h('div', {},
      h('div', { class: 'notice', text: 'Use your current Excel task list (columns: Task Type, Domain, Title Detailed, Assignee, Customer PIC, Status, Progress, Priority, Deadline, Created, Finished, Summary, Notes). Files exported from this app also work.' }),
      field('Excel (.xlsx) or CSV file', fileInput), body, err),
    [h('button', { class: 'btn', text: 'Cancel', onclick: () => dlg.close() }), importBtn]);
  }

  return { exportExcel, exportCsv, openImport };
})();
