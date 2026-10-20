// Turns positioned text pieces from a PDF page or an OCR pass into price-list rows.
// A piece is {str, x0, x1, y, size}; y grows downward. Handles right-to-left (Arabic)
// and left-to-right tables, several tables side by side, and extra columns such as grams.
(function (root) {
  const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  const MARKS = /[‎‏‪-‮⁦-⁩]/g;
  const CURRENCY = /(ج\.?\s?م\.?|جنيه|جنية|egp|le|l\.e\.?)/gi;
  const toLatin = s => String(s).replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).replace(/٫/g, '.');
  const clean = s => String(s).replace(MARKS, '').replace(/\s+/g, ' ').trim();
  const numText = s => clean(s).replace(CURRENCY, '').replace(/(^|\s)\.?م\.?(?=\s|$)/g, ' ').trim();
  const isNumber = s => /^[\d٠-٩][\d٠-٩.,٫٬]*$/.test(numText(s));
  const parsePrice = s => { const m = toLatin(numText(s)).replace(/[٬,](?=\d{3}\b)/g, '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
  const hasLetters = s => /[؀-ۿA-Za-z]{2}/.test(s);
  const PRICE_HEAD = /(السعر|سعر|الثمن|price|cost)/i;
  const NAME_HEAD = /(اسم|الصنف|المنتج|البيان|الوصف|product|item|name|description)/i;

  function lines(pieces) {
    const ps = pieces.filter(p => clean(p.str)).sort((a, b) => a.y - b.y);
    const out = [];
    if (ps.length && ps.every(p => p.line != null)) { // OCR already grouped words into lines
      const by = new Map();
      for (const p of ps) (by.get(p.line) || by.set(p.line, { y: p.y, items: [] }).get(p.line)).items.push(p);
      return [...by.values()].map(l => ({ y: l.items.reduce((s, p) => s + p.y, 0) / l.items.length, items: l.items })).sort((a, b) => a.y - b.y);
    }
    for (const p of ps) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.y - p.y) <= Math.max(2, p.size * 0.4)) last.items.push(p);
      else out.push({ y: p.y, items: [p] });
    }
    return out;
  }

  // OCR sometimes mirrors a bracket in Arabic text: turn an unmatched ')' back into '('.
  function fixBrackets(s) {
    let depth = 0, out = '';
    for (const ch of s) {
      if (ch === '(') { depth++; out += ch; }
      else if (ch === ')') { if (depth) { depth--; out += ch; } else { out += '('; depth++; } }
      else out += ch;
    }
    return out;
  }

  function cells(line, rtl) {
    const items = [...line.items].sort((a, b) => rtl ? b.x1 - a.x1 : a.x0 - b.x0);
    const out = [];
    for (const it of items) {
      const cur = out[out.length - 1];
      const gap = cur ? (rtl ? cur.x0 - it.x1 : it.x0 - cur.x1) : Infinity;
      const s = clean(it.str);
      if (cur && gap < it.size * 1.6) {
        cur.str += (gap > it.size * 0.12 ? ' ' : '') + s;
        cur.x0 = Math.min(cur.x0, it.x0); cur.x1 = Math.max(cur.x1, it.x1);
      } else out.push({ str: s, x0: it.x0, x1: it.x1 });
    }
    return out.map(c => ({ ...c, str: clean(c.str) })).filter(c => c.str);
  }

  // Header line: has a price-like heading and a name-like heading.
  function headerColumns(cs) {
    if (!cs.some(c => PRICE_HEAD.test(c.str)) || !cs.some(c => NAME_HEAD.test(c.str)) || cs.some(c => isNumber(c.str))) return null;
    const cols = cs.map(c => ({ x0: c.x0, x1: c.x1, mid: (c.x0 + c.x1) / 2, label: c.str, kind: PRICE_HEAD.test(c.str) && !NAME_HEAD.test(c.str) ? 'price' : NAME_HEAD.test(c.str) ? 'name' : 'detail' }));
    const prices = cols.filter(c => c.kind === 'price'), names = cols.filter(c => c.kind === 'name');
    const used = new Set();
    const tables = prices.map(p => {
      const n = names.filter(x => !used.has(x)).sort((a, b) => Math.abs(a.mid - p.mid) - Math.abs(b.mid - p.mid))[0];
      if (n) used.add(n);
      return { price: p, name: n, details: [] };
    }).filter(t => t.name);
    for (const d of cols.filter(c => c.kind === 'detail')) {
      const t = tables.slice().sort((a, b) => Math.abs(a.price.mid - d.mid) - Math.abs(b.price.mid - d.mid))[0];
      if (t) t.details.push(d);
    }
    return tables.length ? { tables, cols } : null;
  }

  function columnOf(cell, cols) {
    let best = null, bestScore = -Infinity;
    for (const c of cols) {
      const overlap = Math.min(cell.x1, c.x1) - Math.max(cell.x0, c.x0);
      const score = overlap > 0 ? overlap : -Math.abs((cell.x0 + cell.x1) / 2 - c.mid);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // Without a header: find columns from where cells line up, then call the number column
  // with the most different values the price (a grams or size column repeats a few values).
  function inferLayout(ls) {
    const cand = ls.filter(l => l.cells.some(c => isNumber(c.str)) && l.cells.some(c => !isNumber(c.str) && hasLetters(c.str)));
    if (cand.length < 2) return null;
    const spans = cand.flatMap(l => l.cells).sort((a, b) => a.x0 - b.x0);
    const cols = [];
    for (const c of spans) {
      const last = cols[cols.length - 1];
      if (last && c.x0 <= last.x1) { last.x1 = Math.max(last.x1, c.x1); last.cells.push(c); }
      else cols.push({ x0: c.x0, x1: c.x1, cells: [c] });
    }
    for (const col of cols) {
      col.mid = (col.x0 + col.x1) / 2;
      const nums = col.cells.filter(c => isNumber(c.str));
      col.kind = nums.length >= col.cells.length * 0.6 ? 'num' : 'name';
      col.distinct = new Set(nums.map(c => numText(c.str))).size;
      col.label = '';
    }
    const names = cols.filter(c => c.kind === 'name' && c.cells.length >= cand.length * 0.3);
    if (!names.length) return null;
    const tables = names.map(n => ({ name: n, nums: [], details: [] }));
    for (const c of cols.filter(c => c.kind === 'num')) {
      tables.slice().sort((a, b) => Math.abs(a.name.mid - c.mid) - Math.abs(b.name.mid - c.mid))[0].nums.push(c);
    }
    const out = tables.filter(t => t.nums.length).map(t => {
      const price = t.nums.slice().sort((a, b) => b.distinct - a.distinct)[0];
      return { name: t.name, price, details: t.nums.filter(c => c !== price) };
    });
    return out.length ? { tables: out, cols: cols.filter(c => c.cells.length >= 2) } : null;
  }

  // state carries the last header between pages: {layout, category}
  function readPieces(pieces, state = {}, { useHeader = true } = {}) {
    const rtl = pieces.filter(p => /[؀-ۿ]/.test(p.str)).length >= pieces.filter(p => /[A-Za-z]{3}/.test(p.str)).length;
    const ls = lines(pieces).map(l => ({ y: l.y, cells: cells(l, rtl) }));
    const rows = [], priceBands = [];
    const header = l => useHeader ? headerColumns(l.cells) : null;
    if (!ls.some(header)) state.layout = state.layout || inferLayout(ls);
    const orphans = [];
    let pendingCategory = '';
    for (let i = 0; i < ls.length; i++) {
      const cs = ls[i].cells;
      const head = header(ls[i]);
      if (head) { state.layout = head; if (pendingCategory) state.category = pendingCategory; pendingCategory = ''; continue; }
      const nums = cs.filter(c => isNumber(c.str)).length;
      if (!nums) {
        const text = cs.map(c => c.str).join(' ');
        if (state.layout) for (const c of cs) { const col = columnOf(c, state.layout.cols); const t = state.layout.tables.find(t => t.name === col); if (t && hasLetters(c.str)) orphans.push({ y: ls[i].y, table: t, str: c.str }); }
        // only a lone heading directly above a table header counts as a section name
        pendingCategory = cs.length === 1 && hasLetters(text) && text.length > 3 ? text.replace(/^[|\s]+/, '') : '';
        continue;
      }
      pendingCategory = '';
      if (!state.layout) continue;
      const L = state.layout, byCol = new Map();
      for (const c of cs) { const col = columnOf(c, L.cols); (byCol.get(col) || byCol.set(col, []).get(col)).push(c.str); }
      for (const t of L.tables) {
        const name = (byCol.get(t.name) || []).join(' ');
        const priceStr = (byCol.get(t.price) || []).join(' ');
        if (!name || !hasLetters(name)) continue;
        const detail = t.details.map(d => { const v = (byCol.get(d) || []).join(' '); const label = d.label.replace(/\s*\(.*\)\s*/, ''); return v ? (label ? `${label}: ${v}` : v) : ''; }).filter(Boolean).join(' · ');
        rows.push({ name: fixBrackets(name), price: parsePrice(priceStr), detail, category: state.category || '', y: ls[i].y, priceCol: t.price, table: t, parts: [{ y: ls[i].y, str: name }] });
      }
    }
    // a product name wrapped onto two lines: join the loose text line to the nearest row of its table
    const gap = ls.length > 2 ? Math.min(...ls.slice(1).map((l, i) => l.y - ls[i].y).filter(d => d > 2)) : 0;
    for (const o of orphans) {
      const near = rows.filter(r => r.table === o.table && Math.abs(r.y - o.y) <= gap * 1.6).sort((a, b) => Math.abs(a.y - o.y) - Math.abs(b.y - o.y))[0];
      if (near) { near.parts.push({ y: o.y, str: o.str }); near.parts.sort((a, b) => a.y - b.y); near.name = fixBrackets(near.parts.map(p => p.str).join(' ')); }
    }
    rows.forEach(r => { delete r.table; delete r.parts; });
    for (const t of state.layout?.tables || []) priceBands.push(t.price);
    return { rows: rows.filter(r => /[\u0600-\u06FFA-Za-z]{3}/.test(r.name) && !/@|www\./i.test(r.name)), priceBands };
  }

  // pdf.js text content -> pieces (pdf.js already returns each run in reading order)
  function piecesFromPdf(textContent, viewportHeight) {
    return textContent.items.filter(it => it.str && it.str.trim()).map(it => {
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      return { str: it.str, x0: it.transform[4], x1: it.transform[4] + it.width, y: viewportHeight - it.transform[5], size };
    });
  }

  // A text layer that decodes to control characters or odd scripts is broken; read the page as an image instead.
  function looksBroken(pieces) {
    const text = pieces.map(p => p.str).join('');
    if (!text.length) return true;
    const bad = (text.match(/[\u0000-\u0008\u000b-\u001f԰-֏�]/g) || []).length;
    return bad / text.length > 0.01;
  }

  // tesseract.js words -> pieces
  function piecesFromOcr(lines, minConf = 30) {
    return lines.flatMap((l, i) => l.words.filter(w => clean(w.text) && w.confidence >= minConf).map(w => ({
      str: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y: (w.bbox.y0 + w.bbox.y1) / 2, size: Math.max(6, l.bbox.y1 - l.bbox.y0), line: i,
    })));
  }

  root.TableReader = { readPieces, piecesFromPdf, piecesFromOcr, looksBroken, parsePrice, isNumber };
})(typeof window !== 'undefined' ? window : globalThis);
