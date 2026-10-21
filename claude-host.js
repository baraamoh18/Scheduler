// Runs Supply Price Desk inside claude.ai: stands in for the Firebase SDK the website uses, keeping the
// data in the claude.ai page's own storage (the db capability), and saves files through the downloads
// capability. Only the claude.ai copy of the page loads this file (see scripts/build-claude-page.js).
//
// It covers what index.html uses: firestore().doc/collection/batch, set with {merge: true} and
// FieldValue.delete(), onSnapshot, and an auth() whose user is whoever opened the page in claude.ai.
(function () {
  const use = name => (window.claude && window.claude.use ? window.claude.use(name) : Promise.resolve(null));
  const DELETE = { __spdDelete: true };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  // a plain copy without delete markers (snapshot bodies from the store are frozen)
  const plain = v => JSON.parse(JSON.stringify(v, (k, x) => (x === DELETE ? undefined : x)));
  function mergeInto(target, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v === DELETE) delete target[k];
      else if (isObj(v) && v !== DELETE && isObj(target[k])) mergeInto(target[k], v);
      else target[k] = v === undefined ? undefined : plain(v);
    }
    return target;
  }
  const FULL = 'This page\'s storage is full. Delete an old supplier list, then try again.';
  const wrap = e => {
    const code = e?.code;
    return Object.assign(new Error(e?.message || String(code || e)), {
      code: code === 'quota_exceeded' || code === 'resource_exhausted' ? 'resource-exhausted' : code,
      friendly: code === 'quota_exceeded' ? FULL
        : code === 'resource_exhausted' ? 'Too many changes at once. Wait a moment and try again.'
        : code === 'not_granted' || code === 'revoked' ? 'You can view this page but not change it. Ask its owner for edit access.'
        : undefined,
    });
  };
  const snap = s => ({ id: s.id, exists: s.exists, data: () => (s.exists ? plain(s.data()) : undefined) });

  function docRef(db, path) {
    const ref = db.doc(path);
    return {
      path,
      async set(data, opts) {
        try {
          if (opts && opts.merge) {
            // the store has no merge-with-deletes, so read, merge here and write the whole document
            const cur = await ref.get();
            await ref.set(mergeInto(cur.exists ? plain(cur.data()) : {}, data));
          } else await ref.set(plain(data));
        } catch (e) { throw wrap(e); }
      },
      async delete() { try { await ref.delete(); } catch (e) { throw wrap(e); } },
      onSnapshot: (next, error) => ref.onSnapshot(s => next(snap(s)), e => error && error(wrap(e))),
    };
  }
  function firestoreOn(db) {
    return {
      doc: path => docRef(db, path),
      collection: name => ({
        doc: id => docRef(db, name + '/' + id),
        onSnapshot: (next, error) => db.collection(name).onSnapshot(s => next({ docs: s.docs.map(snap), size: s.size, empty: s.empty }), e => error && error(wrap(e))),
      }),
    };
  }

  const dbReady = use('db');
  let store = null;
  const listeners = [];
  const auth = {
    currentUser: null,
    onAuthStateChanged(cb) {
      listeners.push(cb);
      dbReady.then(db => {
        if (!db) {
          window.gate(`<h2>Open Supply Price Desk in claude.ai</h2><p class="muted">Your price lists are saved with this page in claude.ai. Sign in to claude.ai and open the page from there to see them. If you were sent a link, ask the person who shared it to give you access.</p>`);
          return;
        }
        auth.currentUser = { email: '' };
        cb(auth.currentUser);
      });
    },
    signOut: async () => {},
  };
  const firestore = () => {
    if (!store) {
      // index.html calls firestore() right away; calls on it wait for the store to answer
      store = {
        doc: path => ({
          path,
          set: (data, opts) => dbReady.then(db => firestoreOn(db).doc(path).set(data, opts)),
          delete: () => dbReady.then(db => firestoreOn(db).doc(path).delete()),
          onSnapshot(next, error) { let un = null, stop = false; dbReady.then(db => { if (!stop) un = firestoreOn(db).doc(path).onSnapshot(next, error); }); return () => { stop = true; un && un(); }; },
        }),
        collection: name => ({
          doc: id => store.doc(name + '/' + id),
          onSnapshot(next, error) { let un = null, stop = false; dbReady.then(db => { if (!stop) un = firestoreOn(db).collection(name).onSnapshot(next, error); }); return () => { stop = true; un && un(); }; },
        }),
        batch() {
          const ops = [];
          return { set: (ref, data, opts) => { ops.push(() => ref.set(data, opts)); }, delete: ref => { ops.push(() => ref.delete()); }, commit: async () => { for (const op of ops) await op(); } };
        },
        enablePersistence: async () => {},
      };
    }
    return store;
  };
  firestore.FieldValue = { delete: () => DELETE };

  window.firebase = { initializeApp() {}, auth: () => auth, firestore };
  window.FIREBASE_CONFIG = { apiKey: 'claude-ai' };
  // there is no signing out of a claude.ai page
  const hide = document.createElement('style'); hide.textContent = '#who { display: none !important; }'; document.head.appendChild(hide);

  // Files are offered through claude.ai's save dialog, because the page cannot start downloads itself.
  window.SPD_SAVE_FILE = async (filename, blob) => {
    const downloads = await use('downloads');
    if (!downloads) throw new Error('downloads unavailable');
    await downloads.save({ filename, data: blob });
  };
})();
