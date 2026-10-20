// An in-memory stand-in for the Firebase compat SDK (app, auth, firestore), loaded in place of
// the real scripts during browser tests. It keeps the behaviour the site relies on: snapshot
// listeners that fire after each write, merge writes with FieldValue.delete(), batches, and a
// "permission-denied" error for accounts that are not on the team list.
//
// Tests configure it before the page loads through window.__FAKE = {user, team, docs}, and read
// or change it afterwards through window.__fake (store, remote writes, failing the next write).
(function () {
  const cfg = window.__FAKE || {};
  const KEY = '__fakeFirestore';
  const DELETE = { __delete: true };
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => x === DELETE ? undefined : x));

  // the store survives a page reload within one test, like a real database would
  let store;
  try { store = JSON.parse(sessionStorage.getItem(KEY)); } catch { store = null; }
  if (!store) store = clone(cfg.docs || {});
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch {} };
  persist();

  const team = (cfg.team || ['tester@example.com']).map(e => e.toLowerCase());
  let user = cfg.user === undefined ? { email: 'tester@example.com' } : cfg.user;
  if (sessionStorage.getItem('__fakeUser')) user = JSON.parse(sessionStorage.getItem('__fakeUser'));
  const authListeners = [];
  const listeners = new Set();
  let failNext = null;
  const allowed = () => user && team.includes(String(user.email).toLowerCase());
  const err = code => Object.assign(new Error(code), { code });

  function mergeInto(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v === DELETE) delete target[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) mergeInto(target[k], v);
      else target[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeInto({}, v) : clone(v);
    }
    return target;
  }
  function checkValue(v, inArray) { // Firestore rejects arrays inside arrays
    if (Array.isArray(v)) { if (inArray) throw err('invalid-argument'); v.forEach(x => checkValue(x, true)); }
    else if (v && typeof v === 'object' && v !== DELETE) Object.values(v).forEach(x => checkValue(x, false));
  }
  function notify() { for (const l of [...listeners]) setTimeout(() => listeners.has(l) && l.fire(), 0); }
  function applyWrite(path, data, opts, fromServer) {
    if (!fromServer) {
      if (!allowed()) throw err('permission-denied');
      if (failNext) { const c = failNext; failNext = null; throw err(c); }
    }
    checkValue(data, false);
    if (data === null) delete store[path];
    else if (opts && opts.merge && store[path]) mergeInto(store[path], data);
    else store[path] = mergeInto({}, data);
    persist(); notify();
  }

  const docSnap = path => ({ id: path.split('/').pop(), exists: path in store, data: () => clone(store[path]) });
  function docRef(path) {
    return {
      path,
      set: async (data, opts) => applyWrite(path, data, opts),
      delete: async () => applyWrite(path, null),
      onSnapshot(next, error) { return listen(() => next(docSnap(path)), error); },
    };
  }
  function listen(fire, error) {
    const l = { fire: () => { if (!allowed()) { listeners.delete(l); error && error(err('permission-denied')); return; } fire(); } };
    listeners.add(l); setTimeout(() => listeners.has(l) && l.fire(), 0);
    return () => listeners.delete(l);
  }
  const db = {
    enablePersistence: async () => {},
    doc: docRef,
    collection: name => ({
      onSnapshot(next, error) {
        return listen(() => next({ docs: Object.keys(store).filter(p => p.split('/')[0] === name && p.split('/').length === 2).sort().map(docSnap) }), error);
      },
    }),
    batch() {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push([ref.path, data, opts]),
        delete: ref => ops.push([ref.path, null]),
        commit: async () => {
          if (!allowed()) throw err('permission-denied');
          if (failNext) { const c = failNext; failNext = null; throw err(c); }
          for (const [p, d, o] of ops) applyWrite(p, d, o, true);
        },
      };
    },
  };
  function setUser(u) {
    user = u;
    try { u ? sessionStorage.setItem('__fakeUser', JSON.stringify(u)) : sessionStorage.setItem('__fakeUser', 'null'); } catch {}
    authListeners.forEach(f => setTimeout(() => f(user), 0));
  }
  const auth = {
    get currentUser() { return user; },
    onAuthStateChanged(f) { authListeners.push(f); setTimeout(() => f(user), 0); return () => {}; },
    signInWithPopup: async () => {
      const next = window.__fake.nextSignIn;
      if (next && next.error) throw err(next.error);
      setUser({ email: (next && next.email) || 'tester@example.com' });
    },
    signInWithRedirect: async () => setUser({ email: 'tester@example.com' }),
    signOut: async () => setUser(null),
  };
  function GoogleAuthProvider() {} GoogleAuthProvider.prototype.setCustomParameters = function () {};
  const firestore = () => db;
  firestore.FieldValue = { delete: () => DELETE };
  const authFn = () => auth;
  authFn.GoogleAuthProvider = GoogleAuthProvider;
  window.firebase = { initializeApp: c => { window.__fake.config = c; }, auth: authFn, firestore };

  window.__fake = {
    get store() { return clone(store); },
    doc: path => clone(store[path]),
    // a change made by someone else on the team
    remoteSet: (path, data, merge) => applyWrite(path, data, { merge }, true),
    remoteDelete: path => applyWrite(path, null, null, true),
    failNextWrite: code => { failNext = code || 'unavailable'; },
    nextSignIn: null,
    setUser,
  };
})();
