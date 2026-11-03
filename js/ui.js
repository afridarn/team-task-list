'use strict';
/* Shared UI helpers. All text is inserted with textContent (never innerHTML),
   so task content cannot inject markup or script. */
window.TH = window.TH || {};
TH.ui = (() => {
  const STATUSES = ['Pending', 'On Work', 'Finished'];
  const PRIORITIES = ['High', 'Medium', 'Low'];
  let uid = 0;

  const $ = (s, el = document) => el.querySelector(s);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let deferredValue;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') deferredValue = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (deferredValue !== undefined) el.value = deferredValue;
    return el;
  }

  function toast(msg, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), bad ? 6000 : 3000);
  }

  // ------------------------------------------------------------------ dates
  const pad = (n) => String(n).padStart(2, '0');
  const dayDiff = (s) => {
    const d = new Date(s), n = new Date();
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  };
  const daysLeft = (t) => (t.deadline ? dayDiff(t.deadline) : null);
  const isOpen = (t) => t.status !== 'Finished';
  const isLate = (t) => !!(isOpen(t) && t.deadline && daysLeft(t) < 0);
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const slug = (s) => s.replace(/ /g, '-');

  function dueInfo(t) {
    if (!t.deadline) return { text: 'No deadline', cls: '' };
    const n = daysLeft(t), d = fmtDate(t.deadline);
    if (!isOpen(t)) return { text: d, cls: '' };
    if (n < 0) return { text: d + ' · ' + -n + 'd overdue', cls: 'late' };
    if (n === 0) return { text: 'Due today', cls: 'soon' };
    return { text: d + ' · ' + n + 'd left', cls: n <= 3 ? 'soon' : '' };
  }

  const statusBadge = (s) => h('span', { class: 'badge s-' + slug(s), text: s });
  const prioBadge = (p) => h('span', { class: 'badge p-' + p, text: p });
  function progressBar(p) {
    const i = h('i'); i.style.width = p + '%';
    return h('div', { class: 'pbar', title: p + '%' }, i);
  }

  // ---------------------------------------------------------------- dialogs
  function dialog(title, body, foot, narrow, locked) {
    const dlg = h('dialog', { class: narrow ? 'narrow' : '' },
      h('div', { class: 'dlg-head' }, h('h2', { text: title }),
        !locked && h('button', { class: 'btn small', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() })),
      h('div', { class: 'dlg-body' }, body), h('div', { class: 'dlg-foot' }, foot));
    if (locked) dlg.addEventListener('cancel', (e) => e.preventDefault());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }

  function field(label, input, hint) {
    input.id = 'f' + (++uid);
    return h('div', { class: 'field' }, h('label', { for: input.id, text: label }), input, hint && h('div', { class: 'hint', text: hint }));
  }

  return { STATUSES, PRIORITIES, $, h, toast, pad, dayDiff, daysLeft, isOpen, isLate, fmtDate, fmtDateTime, slug,
    dueInfo, statusBadge, prioBadge, progressBar, dialog, field };
})();
