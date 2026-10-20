// Suggests which items from different suppliers are the same product, with a confidence level
// and the reasons behind it. Nothing is linked automatically: people confirm each pair.
// A product is {pid, name, detail, sids: Set of supplier ids, price}.
(function (root) {
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  // the same brand written different ways
  const SYNONYMS = [[/(تراي|ثري|تري|3)\s?ام(?![؀-ۿ])/g, ' تريام '], [/\b3\s?m\b/g, ' تريام ']];
  const UNITS = new Set(['سم', 'م', 'مم', 'ملم', 'cm', 'mm', 'm', 'مل', 'ml', 'لتر', 'l', 'جم', 'جرام', 'جرامات', 'g', 'gm', 'gr', 'كجم', 'كيلو', 'kg', 'مجم', 'mg', 'مج', 'ميكرون', 'cc', 'سي', 'انش', 'بوصه', 'inch', 'x']);
  const LETTER_SIZES = /^(x{0,3}s|m|x{0,4}l|\dx?l|صغير|وسط|كبير|small|medium|large)$/;
  const PACKS = new Set(['توب', 'علبه', 'علب', 'كرتونه', 'كرتون', 'باكو', 'باكت', 'دسته', 'رول', 'رولات', 'لفه', 'قطعه', 'حبه', 'شريط', 'كيس', 'box', 'pack', 'pcs', 'roll']);
  const STOP = new Set(['من', 'في', 'مع', 'و', 'عدد', 'نوع', 'لون']);
  // detail columns that describe the price, not the item (discount, stock, codes)
  const NOT_ITEM = /^(خصم|الخصم|نسبه|discount|رصيد|الرصيد|كميه|الكميه|qty|stock|سعر|السعر|price|بونص|bonus|كود|الكود|code|باركود|barcode|تاريخ|date)/i;

  function clean(s) {
    s = String(s || '').replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).replace(/[٫]/g, '.').replace(/٬/g, ',')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d)[,،](\d)/g, '$1.$2')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '')
      .replace(/([؀-ۿ])\1{2,}/g, '$1').toLowerCase();
    for (const [re, to] of SYNONYMS) s = s.replace(re, to);
    return s.replace(/(\d)(?=[^\d.\s])|([^\d.\s])(?=\d)/g, '$1$2 ') // "10سم" -> "10 سم"
      .replace(/[*×\/\\+\-:()\[\]{}"'،,؛;|_]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // What matching looks at for one item: its words, its sizes and its pack words.
  function describe(name, detail) {
    const parts = String(detail || '').split(' · ').filter(d => !NOT_ITEM.test(clean(d)));
    const words = [], sizes = [], letters = [], packs = [];
    for (let t of clean(name + ' ' + parts.join(' ')).split(' ')) {
      if (!t) continue;
      if (/^\d+(\.\d+)?$/.test(t)) { sizes.push(String(parseFloat(t))); continue; }
      if (LETTER_SIZES.test(t)) { letters.push(t); continue; }
      if (UNITS.has(t) || STOP.has(t)) continue;
      if (PACKS.has(t)) { packs.push(t); continue; }
      if (t.length > 4 && t.startsWith('ال')) t = t.slice(2);
      if (t.length < 2) continue;
      words.push(t);
    }
    return { words: [...new Set(words)], sizes: sizes.sort().join(' '), letters: letters.sort().join(' '), packs: [...new Set(packs)].sort().join(' ') };
  }

  function near(a, b) { // one or two letters apart: spelling variants of the same word
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 2) return false;
    const max = Math.min(a.length, b.length) >= 7 ? 2 : 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (Math.min(...cur) > max) return false;
      prev = cur;
    }
    return prev[b.length] <= max;
  }

  // Compares two described items. Returns null when they can't be the same product.
  function compare(A, B, w) {
    if (A.sizes && B.sizes && A.sizes !== B.sizes) return null; // different size, length, count…
    if (A.letters && B.letters && A.letters !== B.letters) return null; // S vs XL
    const onlyA = A.words.filter(t => !B.words.includes(t)), onlyB = B.words.filter(t => !A.words.includes(t));
    let shared = A.words.filter(t => B.words.includes(t)).reduce((s, t) => s + w(t), 0);
    const spelled = [];
    for (const a of [...onlyA]) {
      const b = onlyB.find(x => near(a, x));
      if (!b) continue;
      shared += 0.8 * Math.min(w(a), w(b)); spelled.push([a, b]);
      onlyA.splice(onlyA.indexOf(a), 1); onlyB.splice(onlyB.indexOf(b), 1);
    }
    if (!shared) return null;
    const wa = shared + onlyA.reduce((s, t) => s + w(t), 0), wb = shared + onlyB.reduce((s, t) => s + w(t), 0);
    const jac = shared / (wa + wb - shared), cont = shared / Math.min(wa, wb);
    return { score: (jac + cont) / 2, jac, cont, onlyA, onlyB, spelled };
  }

  const LEVELS = ['low', 'medium', 'high'];
  function suggest(products, opts = {}) {
    const dismissed = opts.dismissed || {}, perProduct = opts.perProduct || 3, minScore = opts.minScore ?? 0.4;
    const info = new Map(), df = {};
    for (const p of products) { const d = describe(p.name, p.detail); info.set(p, d); d.words.forEach(t => df[t] = (df[t] || 0) + 1); }
    const N = products.length || 1, w = t => Math.log(1 + N / (df[t] || 1));
    const index = {};
    for (const p of products) info.get(p).words.forEach(t => { if (df[t] < Math.max(60, N * 0.08)) (index[t] ||= []).push(p); });
    const out = [], seen = new Set();
    for (const a of products) {
      const A = info.get(a), cand = new Set();
      A.words.forEach(t => (index[t] || []).forEach(b => { if (b !== a) cand.add(b); }));
      for (const b of cand) {
        if ([...b.sids].some(s => a.sids.has(s))) continue; // the same supplier on both sides
        const pk = [a.pid, b.pid].sort().join('|');
        if (seen.has(pk) || dismissed[pk]) continue;
        seen.add(pk);
        const B = info.get(b), c = compare(A, B, w);
        if (!c || c.score < minScore) continue;
        const notes = [];
        let level = c.jac >= 0.85 ? 2 : c.cont >= 0.75 ? 1 : 0;
        if (A.sizes && B.sizes) notes.push({ ok: true, text: 'Same size ' + A.sizes.replace(/ /g, ' × ') });
        else if (A.sizes || B.sizes) { notes.push({ text: 'Only one name gives a size (' + (A.sizes || B.sizes).replace(/ /g, ' × ') + ')' }); level = Math.min(level, 1); }
        if (A.packs !== B.packs) { notes.push({ text: A.packs && B.packs ? `Pack differs: ${A.packs} / ${B.packs}` : `Only one name says the pack (${A.packs || B.packs})` }); level = Math.min(level, 1); }
        const lo = Math.min(a.price, b.price), hi = Math.max(a.price, b.price);
        const ratio = lo > 0 ? hi / lo : 1;
        if (ratio >= 2.5) { notes.push({ text: `Prices are ${ratio.toFixed(1)}× apart, so check the pack or unit` }); level = Math.min(level, 1); }
        if (notes.filter(n => !n.ok).length > 1) level = 0;
        if (c.spelled.length) notes.push({ ok: true, text: 'Spelled differently: ' + c.spelled.map(([x, y]) => x + ' / ' + y).join(', ') });
        out.push({ a, b, pk, score: c.score, level: LEVELS[level], rank: level + c.score, onlyA: c.onlyA, onlyB: c.onlyB, notes });
      }
    }
    out.sort((x, y) => y.rank - x.rank);
    // keep each product's strongest candidates so one item can't flood the list
    const used = {};
    return out.filter(s => {
      const ok = (used[s.a.pid] || 0) < perProduct && (used[s.b.pid] || 0) < perProduct;
      if (ok) { used[s.a.pid] = (used[s.a.pid] || 0) + 1; used[s.b.pid] = (used[s.b.pid] || 0) + 1; }
      return ok;
    });
  }

  root.Matcher = { clean, describe, compare, suggest };
})(typeof window !== 'undefined' ? window : globalThis);
