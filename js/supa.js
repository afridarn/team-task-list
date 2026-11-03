'use strict';
/* Minimal Supabase client (Auth + REST) written with plain fetch: no third-party code.
   Every request carries the signed-in user's token, so the database's Row Level Security
   rules (supabase/schema.sql) decide what each person may read or change. */
window.TH = window.TH || {};
TH.supa = (() => {
  const cfg = window.TASKHUB_CONFIG || {};
  const base = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  const store = cfg.KEEP_SIGNED_IN === false ? window.sessionStorage : window.localStorage;
  const SKEY = 'taskhub.session.v1';
  let session = null, refreshing = null, onSignedOut = () => {};
  try { session = JSON.parse(store.getItem(SKEY) || 'null'); } catch (e) { session = null; }

  const configured = () => /^https:\/\//i.test(base) && !/YOUR/i.test(base) && !!cfg.SUPABASE_KEY && !/YOUR/i.test(cfg.SUPABASE_KEY);

  class ApiError extends Error {
    constructor(msg, status) { super(msg); this.status = status; }
  }

  function save(s) {
    session = s;
    try { s ? store.setItem(SKEY, JSON.stringify(s)) : store.removeItem(SKEY); } catch (e) { /* storage blocked */ }
  }
  function setSession(d) {
    save({ access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: { id: d.user.id, email: d.user.email } });
  }

  function messageFrom(data, status) {
    const m = data && typeof data === 'object' ? (data.msg || data.message || data.error_description || data.error) : null;
    if (m && /row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
    if (m) return String(m);
    if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
    return 'Request failed (' + status + ').';
  }

  async function http(path, { method = 'GET', headers = {}, body, token } = {}) {
    const hd = { apikey: cfg.SUPABASE_KEY, ...headers };
    if (token) hd.Authorization = 'Bearer ' + token;
    if (body !== undefined) hd['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(base + path, { method, headers: hd, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new ApiError('Cannot reach the server. Check your connection.', 0); }
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
    if (!res.ok) throw new ApiError(messageFrom(data, res.status), res.status);
    return { data, res };
  }

  // ----------------------------------------------------------------- auth
  async function signIn(email, password) {
    try {
      const { data } = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: String(email).trim(), password } });
      setSession(data);
      return session.user;
    } catch (e) {
      if (e.status === 400 && /not confirmed/i.test(e.message)) throw new ApiError('This email has not been confirmed yet. Ask an admin.', 400);
      if (e.status === 400) throw new ApiError('Invalid email or password.', 400);
      throw e;
    }
  }

  async function refresh() {
    if (!session) throw new ApiError('Not signed in.', 401);
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const { data } = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
          setSession(data);
        } catch (e) {
          if (e.status >= 400 && e.status < 500) { save(null); onSignedOut(); }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  async function authed(path, opt = {}) {
    if (!session) throw new ApiError('Not signed in.', 401);
    if (session.expires_at - Date.now() / 1000 < 60) await refresh();
    try {
      return await http(path, { ...opt, token: session.access_token });
    } catch (e) {
      if (e.status !== 401) throw e;
      await refresh();
      try { return await http(path, { ...opt, token: session.access_token }); } catch (e2) {
        if (e2.status === 401) { save(null); onSignedOut(); }
        throw e2;
      }
    }
  }

  async function signOut() {
    const token = session && session.access_token;
    save(null);
    if (token) { try { await http('/auth/v1/logout', { method: 'POST', token }); } catch (e) { /* already gone */ } }
  }

  async function changePassword(current, next) {
    const email = session.user.email;
    try { await signIn(email, current); } catch (e) {
      throw new ApiError(e.status === 400 ? 'Current password is incorrect.' : e.message, e.status);
    }
    await authed('/auth/v1/user', { method: 'PUT', body: { password: next } });
  }

  // ----------------------------------------------------------------- data
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
  const isId = (n) => Number.isInteger(n) && n > 0;
  const bad = () => new ApiError('Invalid id.', 400);
  const REP = { Prefer: 'return=representation' };
  const PROFILE_COLS = 'id,email,display_name,role,active,created_at';
  const rest = async (path, opt) => (await authed('/rest/v1/' + path, opt)).data;
  const denied = () => new ApiError('Not allowed, or the record no longer exists.', 403);

  return {
    configured,
    hasSession: () => !!session,
    userId: () => session && session.user.id,
    onSignedOut: (f) => { onSignedOut = f; },
    signIn, signOut, changePassword,

    async me() { const r = await rest('profiles?select=' + PROFILE_COLS + '&id=eq.' + session.user.id); return r[0] || null; },
    profiles: () => rest('profiles?select=' + PROFILE_COLS + '&order=display_name.asc'),

    async tasks() {
      const out = [];
      for (let from = 0; ; from += 1000) {
        let r;
        try { r = await rest('tasks?select=*&order=id.asc', { headers: { 'Range-Unit': 'items', Range: from + '-' + (from + 999) } }); }
        catch (e) { if (e.status === 416) break; throw e; }
        out.push(...r);
        if (r.length < 1000) break;
      }
      return out;
    },
    async createTask(obj) { return (await rest('tasks', { method: 'POST', headers: REP, body: obj }))[0]; },
    async updateTask(id, patch) {
      if (!isId(id)) throw bad();
      const r = await rest('tasks?id=eq.' + id, { method: 'PATCH', headers: REP, body: patch });
      if (!r.length) throw denied();
      return r[0];
    },
    async deleteTask(id) {
      if (!isId(id)) throw bad();
      const r = await rest('tasks?id=eq.' + id, { method: 'DELETE', headers: REP });
      if (!r.length) throw denied();
    },
    deleteAllTasks: () => rest('tasks?id=gt.0', { method: 'DELETE', headers: { Prefer: 'return=minimal' } }),
    async bulkInsert(rows, onProgress) {
      for (let i = 0; i < rows.length; i += 100) {
        await rest('tasks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: rows.slice(i, i + 100) });
        if (onProgress) onProgress(Math.min(i + 100, rows.length), rows.length);
      }
    },
    history(id) {
      if (!isId(id)) throw bad();
      return rest('audit_log?select=ts,username,action,detail&task_id=eq.' + id + '&order=id.desc&limit=50');
    },
    audit: () => rest('audit_log?select=id,ts,username,action,task_id,detail&order=id.desc&limit=500'),
    async updateProfile(id, patch) {
      if (!isUuid(id)) throw bad();
      const r = await rest('profiles?id=eq.' + id, { method: 'PATCH', headers: REP, body: patch });
      if (!r.length) throw denied();
      return r[0];
    },
  };
})();
