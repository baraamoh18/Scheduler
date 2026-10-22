// An in-memory stand-in for claude.ai's page capabilities (window.claude.use), for testing the
// claude.ai copy of the site: db (documents, snapshots), sample (Claude's answers) and downloads.
// Tests set window.__CLAUDE = {docs, signedOut, answers, chatText, toolCall} before the page loads
// and read window.__claude (store, calls, saved files) afterwards.
(function () {
  const cfg = window.__CLAUDE || {};
  const store = JSON.parse(JSON.stringify(cfg.docs || {}));
  const listeners = new Set();
  const deepFreeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };
  const snap = path => ({ id: path.split('/').pop(), exists: path in store, data: () => (path in store ? deepFreeze(JSON.parse(JSON.stringify(store[path]))) : undefined), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = () => { for (const l of [...listeners]) setTimeout(() => listeners.has(l) && l(), 0); };
  const db = {
    doc: path => ({
      id: path.split('/').pop(), path,
      get: async () => snap(path),
      set: async data => { if (JSON.stringify(data).length > 256 * 1024) throw { code: 'invalid_argument', message: 'too big' }; store[path] = JSON.parse(JSON.stringify(data)); notify(); },
      delete: async () => { delete store[path]; notify(); },
      onSnapshot(next) { const l = () => next(snap(path)); listeners.add(l); l(); return () => listeners.delete(l); },
    }),
    collection: name => ({
      onSnapshot(next) {
        const l = () => { const docs = Object.keys(store).filter(p => p.split('/').length === 2 && p.startsWith(name + '/')).sort().map(snap); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }); };
        listeners.add(l); l(); return () => listeners.delete(l);
      },
    }),
  };
  const calls = [], saved = [];
  async function sample(input, opts = {}) {
    calls.push({ input, tools: (opts.tools || []).map(t => t.name) });
    if (opts.tools && cfg.toolCall) {
      const tool = opts.tools.find(t => t.name === cfg.toolCall.name);
      const result = await tool.execute(cfg.toolCall.input, { signal: new AbortController().signal });
      calls[calls.length - 1].toolResult = result;
      const p = result.products?.[0];
      const text = (cfg.chatText || 'Cheapest is ') + (p ? `[[${p.pid}|${p.name}]]` : 'nothing');
      opts.onText?.({ text, delta: text });
      return { text, truncated: false, modelTierApplied: 'default' };
    }
    const text = cfg.chatText || 'Nile is cheapest per piece on every size.';
    opts.onText?.({ text: text.slice(0, 5), delta: text.slice(0, 5) });
    opts.onText?.({ text, delta: text.slice(5) });
    return { text, truncated: false, modelTierApplied: 'default' };
  }
  sample.json = async (input, opts = {}) => {
    calls.push({ input, images: (opts.images || []).length });
    const a = cfg.answers || {};
    if (/^Read this page/.test(input)) return a.scan;
    if (/Two items from different suppliers/.test(input)) return a.match;
    // a review of many pairs: answers.review = {"part of a name": "same" | "different"}, others "unsure"
    if (/^Each pair below/m.test(input)) {
      const pairs = JSON.parse(input.split('\n').find(l => l.startsWith('[{"n":')));
      return { results: pairs.map(p => ({ n: p.n, verdict: Object.entries(a.review || {}).find(([k]) => (p.itemA.name + p.itemB.name).includes(k))?.[1] || 'unsure', why: 'checked' })) };
    }
    // '$0', '$1' in a product answer stand for the keys of the offers in the prompt, in order
    const keys = [...input.matchAll(/"key":"([^"]+)"/g)].map(m => m[1]);
    return JSON.parse(JSON.stringify(a.product || {}).replace(/"\$(\d)"/g, (m, i) => JSON.stringify(keys[+i])));
  };
  sample.limits = async () => ({ maxPromptBytes: 200000, images: { maxCount: 5, maxInputBytes: 5e6, mediaTypes: ['image/jpeg'] }, tools: { maxCount: 10 } });
  const downloads = { save: async ({ filename, data }) => { saved.push({ filename, size: data.size, text: await data.text() }); return { status: 'saved' }; } };
  const caps = { db: cfg.signedOut ? null : db, sample, downloads };
  window.claude = { use: name => new Promise(ok => setTimeout(() => ok(caps[name] ?? null), 5)) };
  window.__claude = { store, calls, saved };
})();
