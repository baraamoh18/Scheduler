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
  // Word lists people can edit (Settings > Matching words), one group per line.
  // same: words that mean the same thing ("دريسنج = درسنج = غيار جراحي"); the first one is used for all of them.
  // brands: one brand per line; a brand only counts when both names have one.
  // opposites: words that tell two items apart ("اطفال / كبار"); a pair with different ones is never suggested.
  const DEFAULT_WORDS = {
    same: [
      'دريسنج = درسنج = غيار جراحي = dressing',
      'جوانتي = جوانتيات = قفاز = gloves = glove',
      'كمامه = ماسك وجه = face mask',
      'ديجيتال = ديجتال = رقمي = digital',
      'سرنجه = سرنجات = سرنج = syringe',
      'اخضر = خضراء = خضرا = green',
      'ازرق = زرقاء = زرقا = blue',
      'اصفر = صفراء = صفرا = yellow',
      'احمر = حمراء = حمرا = red',
      'ابيض = بيضاء = بيضا = white',
      'اسود = سوداء = سودا = black',
      'رصاصي = رمادي = gray = grey',
      'بمبي = روز = وردي = pink',
      'برتقالي = orange',
      'بنفسجي = violet = purple',
      'شمال = يسار = left',
      'يمين = right',
      'فولي = قسطره فولي = foley',
      'اطفال = طفل = pediatric = kids',
      'كبار = بالغين = adult',
    ].join('\n'),
    brands: ['تراي ام', 'ميراج', 'موف', 'هيلثي', 'ميدي كير', 'الترا لايف', 'الترا', 'فرست', 'فايف ستار', 'ماسكو', 'جرانزيا', 'دولفين',
      'فارما بلاست', 'فارما بيور', 'رويال', 'نوفو كاث', 'بيوفلون', 'رينو ميد', 'زهره المحله', 'ماس المحله', 'كليوباترا', 'اميكاث',
      'مارامكو', 'ياسي', 'اكوا تشيك', 'بريس تشيك', 'ميد بلص', 'ميد بلس', 'باندا', 'ايلاستو بلاست', 'فينوزان = فينوسان'].join('\n'),
    opposites: [
      'اطفال / كبار / سيدات / رضع / حديثي الولاده',
      'فوق الركبه / تحت الركبه',
      'يمين / شمال',
      'لاصق / غير لاصق',
      'معقم / غير معقم',
      'اخضر / ازرق / اصفر / احمر / ابيض / اسود / رصاصي / بمبي / برتقالي / بنفسجي / كحلي / لبني / بيج',
      'صيني / هندي / تركي / مصري / الماني / ماليزي / تايلاندي / كوري / ياباني',
    ].join('\n'),
  };
  const STOP = new Set(['من', 'في', 'مع', 'و', 'عدد', 'نوع', 'لون', 'طول', 'عرض', 'مقاس', 'مقاسات']);
  // detail columns that describe the price or pack, not the item (discount, pack, stock, codes)
  const NOT_ITEM = /^(علبه|عبوه|العبوه|الوحده|وحده|كرتونه|pack|unit|carton|خصم|الخصم|نسبه|discount|رصيد|الرصيد|كميه|الكميه|qty|stock|سعر|السعر|price|بونص|bonus|كود|الكود|code|باركود|barcode|تاريخ|date)/i;

  function clean(s, plain) {
    s = String(s || '').replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).replace(/[٫]/g, '.').replace(/٬/g, ',')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/(\d)[,،](\d)/g, '$1.$2')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '')
      .replace(/([؀-ۿ])\1{2,}/g, '$1').toLowerCase();
    for (const [re, to] of SYNONYMS) s = s.replace(re, to);
    s = s.replace(/(\d)(?=[^\d.\s])|([^\d.\s])(?=\d)/g, '$1$2 ') // "10سم" -> "10 سم"
      .replace(/([a-z])(?=[؀-ۿ])|([؀-ۿ])(?=[a-z])/g, '$1$2 ') // "Lشراب" -> "l شراب"
      .replace(/[*×\/\\+\-:()\[\]{}"'،,؛;|_]/g, ' ').replace(/\s+/g, ' ').trim();
    return plain || !W.re ? s : s.replace(W.re, (m, al, phrase) => W.to[phrase]);
  }

  // The word lists in use, turned into one search: every listed phrase (with or without "ال") becomes one token,
  // so "زرقاء" reads as "ازرق" and "ميدي كير" as the single brand token "ميديكير".
  let W = {};
  function setWords(lists = {}) {
    const text = k => lists[k] != null ? String(lists[k]) : DEFAULT_WORDS[k];
    const groups = k => text(k).split(/\n/).map(l => l.split(k === 'opposites' ? /[\/،,]/ : '=').map(x => clean(x, true)).filter(Boolean)).filter(g => g.length);
    const to = {}, brands = new Set(), opp = {};
    const tok = x => x.replace(/ /g, '');
    for (const g of groups('same')) g.forEach(x => to[x] = tok(g[0]));
    for (const g of groups('brands')) g.forEach(x => { to[x] = tok(g[0]); brands.add(tok(g[0])); });
    groups('opposites').forEach((g, i) => g.forEach(x => { const t = to[x] || tok(x); if (x.includes(' ')) to[x] ||= t; (opp[t] ||= []).push(i); }));
    const phrases = Object.keys(to).sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    W = { to, brands, opp, re: phrases.length ? new RegExp('(?<=^| )(ال)?(' + phrases.join('|') + ')(?= |$)', 'g') : null, lists };
    return W;
  }

  // What matching looks at for one item: its words, brand, sizes, weight or strength, pack words,
  // and the "opposite" words (kids/adults, colour…) that tell it apart from similar items.
  const WEIGHT = new Set(['جرام', 'جم', 'جرامات', 'g', 'gm', 'gr', 'gsm']), CODE = new Set(['كود', 'code', 'موديل', 'model']);
  function describe(name, detail) {
    const parts = String(detail || '').split(' · ').filter(d => !NOT_ITEM.test(clean(d, true)));
    const words = [], brands = [], sizes = [], specs = [], letters = [], packs = [], opp = {};
    const toks = clean(name + ' ' + parts.join(' ')).split(' ');
    toks.forEach((t, i) => {
      if (!t || t === '%') return;
      const prev = (toks[i - 1] || '').replace(/^ال/, ''), next = toks[i + 1] || '';
      if (/^\d+(\.\d+)?$/.test(t)) {
        const n = String(parseFloat(t));
        if (CODE.has(prev)) return; // a catalogue code, not a size
        if (WEIGHT.has(next) || WEIGHT.has(prev)) specs.push(n + 'g'); // 35 جرام: the cloth weight
        else if (next === '%' || toks[i - 1] === '%') specs.push(n + '%'); // 70% alcohol, 5% iodine
        else sizes.push(n);
        return;
      }
      if (W.opp[t]) W.opp[t].forEach(g => (opp[g] ||= new Set()).add(t));
      if (W.brands.has(t)) { brands.push(t); return; }
      if (LETTER_SIZES.test(t)) { letters.push(t); return; }
      if (UNITS.has(t) || STOP.has(t) || WEIGHT.has(t) || CODE.has(t)) return;
      if (t.length > 4 && t.startsWith('ال') && !W.opp[t]) t = t.slice(2);
      if (PACKS.has(t)) { packs.push(t); return; }
      if (t.length < 2) return;
      words.push(t);
    });
    return { words: [...new Set(words)], brands: [...new Set(brands)], sizes: sizes.sort().join(' '), specs: [...new Set(specs)].sort().join(' '), letters: letters.sort().join(' '), packs: [...new Set(packs)].sort().join(' '), opp };
  }

  function near(a, b) { // one or two letters apart: spelling variants of the same word
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 2) return false;
    if (a.slice(0, 2) !== b.slice(0, 2)) return false; // رباعي and سباعي are different words
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

  // true when one name lists every size of the other plus more, like "5 سم" and "5 سم طول 150م"
  function extraSize(a, b) {
    const [s, l] = a.length < b.length ? [a.split(' '), b.split(' ')] : [b.split(' '), a.split(' ')];
    return s.length < l.length && s.every(x => { const i = l.indexOf(x); if (i < 0) return false; l.splice(i, 1); return true; });
  }

  // Compares two described items. Returns null when they can't be the same product.
  function compare(A, B, w) {
    if (A.sizes && B.sizes && A.sizes !== B.sizes && !extraSize(A.sizes, B.sizes)) return null; // different size, length, count…
    if (A.letters && B.letters && A.letters !== B.letters) return null; // S vs XL
    if (A.specs && B.specs && A.specs !== B.specs) return null; // 22 جرام vs 35 جرام
    const oneSided = [];
    for (const g in A.opp) if (!B.opp[g]) oneSided.push(...A.opp[g]); else if (![...A.opp[g]].some(t => B.opp[g].has(t))) return null; // kids vs adults, red vs blue
    for (const g in B.opp) if (!A.opp[g]) oneSided.push(...B.opp[g]);
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
    const sameBrand = A.brands.filter(t => B.brands.includes(t));
    shared += sameBrand.reduce((s, t) => s + w(t), 0); // a brand only counts when both names share it
    const otherBrand = A.brands.length && B.brands.length && !sameBrand.length ? [A.brands.join(' '), B.brands.join(' ')] : null;
    // a brand on one side only counts as an extra word, since the other name may hide a brand the list doesn't know
    if (!otherBrand) { onlyA.push(...A.brands.filter(t => !sameBrand.includes(t))); onlyB.push(...B.brands.filter(t => !sameBrand.includes(t))); }
    const wx = t => W.brands.has(t) ? w(t) / 2 : w(t); // a one-sided brand weighs half
    const wa = shared + onlyA.reduce((s, t) => s + wx(t), 0), wb = shared + onlyB.reduce((s, t) => s + wx(t), 0);
    const jac = shared / (wa + wb - shared), cont = shared / Math.min(wa, wb);
    return { score: (jac + cont) / 2, jac, cont, onlyA, onlyB, spelled, sameBrand, otherBrand, oneSided };
  }

  const LEVELS = ['low', 'medium', 'high'];
  // a listed phrase shown as it was written in the list ("ميديكير" -> "ميدي كير")
  const show = t => Object.keys(W.to).find(x => W.to[x] === t && x.replace(/ /g, '') === t) || t;
  function suggest(products, opts = {}) {
    if (opts.words && opts.words !== W.lists) setWords(opts.words);
    const dismissed = opts.dismissed || {}, perProduct = opts.perProduct || 3, minScore = opts.minScore ?? 0.4;
    const info = new Map(), df = {};
    for (const p of products) { const d = describe(p.name, p.detail); info.set(p, d); [...d.words, ...d.brands].forEach(t => df[t] = (df[t] || 0) + 1); }
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
        if (A.sizes && B.sizes && A.sizes !== B.sizes) { notes.push({ text: `One name gives an extra size (${A.sizes.replace(/ /g, ' × ')} / ${B.sizes.replace(/ /g, ' × ')})` }); level = Math.min(level, 1); }
        else if (A.sizes && B.sizes) notes.push({ ok: true, text: 'Same size ' + A.sizes.replace(/ /g, ' × ') });
        else if (A.sizes || B.sizes) { notes.push({ text: 'Only one name gives a size (' + (A.sizes || B.sizes).replace(/ /g, ' × ') + ')' }); level = Math.min(level, 1); }
        if (c.oneSided.length) { notes.push({ text: 'Only one name says ' + c.oneSided.map(show).join('، ') }); level = Math.min(level, 1); }
        if (A.specs !== B.specs) { notes.push({ text: 'Only one name gives the weight or strength (' + (A.specs || B.specs) + ')' }); level = Math.min(level, 1); }
        if (A.packs !== B.packs) { notes.push({ text: A.packs && B.packs ? `Pack differs: ${A.packs} / ${B.packs}` : `Only one name says the pack (${A.packs || B.packs})` }); level = Math.min(level, 1); }
        const lo = Math.min(a.price, b.price), hi = Math.max(a.price, b.price);
        const ratio = lo > 0 ? hi / lo : 1;
        if (ratio >= 2.5) { notes.push({ text: `Prices are ${ratio.toFixed(1)}× apart, so check the pack or unit` }); level = Math.min(level, 1); }
        if (notes.filter(n => !n.ok).length > 1) level = 0;
        if (c.otherBrand) { notes.unshift({ text: 'Different brand: ' + c.otherBrand.map(show).join(' / ') }); level = 0; }
        else if (c.sameBrand.length) notes.push({ ok: true, text: 'Same brand ' + c.sameBrand.map(show).join(' ') });
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

  // Search text: written the matching way, so "قفاز" also finds "جوانتي" and "زرقاء" finds "ازرق".
  const keys = new Map();
  function searchKey(s) {
    let k = keys.get(s);
    if (k == null) { if (keys.size > 50000) keys.clear(); keys.set(s, k = clean(s)); }
    return k;
  }
  function words() { return W.lists; }

  setWords();
  root.Matcher = { clean, describe, compare, suggest, setWords, words, searchKey, near, DEFAULT_WORDS };
})(typeof window !== 'undefined' ? window : globalThis);
