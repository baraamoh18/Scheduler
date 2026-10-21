// Claude's help on the claude.ai copy of Supply Price Desk (the sample capability): explain a product and
// its supplier offers, check a suggested match, explain a Compare grid, answer questions about the price
// lists, and read scanned price lists. index.html calls these through window.SPD_AI; the website has none.
// Every answer is advice: nothing is linked or changed until someone presses a button.
(function () {
  const sampleP = window.claude && window.claude.use ? window.claude.use('sample') : Promise.resolve(null);
  const answers = new Map(); // slot key -> {state: 'busy'|'done'|'error', data, text, error, view}
  const r2 = n => Math.round(n * 100) / 100;
  const ROLE = 'You help a small medical-supplies business in Egypt compare supplier price lists. Item names are mostly Arabic and prices are in Egyptian pounds. A listed price may be for a box or pack rather than one piece, so suppliers are compared on the net price of one piece: the listed price, less the discount %, divided by the pieces per pack. Write plain, short English and keep item names exactly as written.';

  const style = document.createElement('style');
  style.textContent = `
.ai { border: 1px solid var(--line); background: var(--surface-2); border-radius: var(--r); padding: 12px; display: grid; gap: 8px; min-width: 0; }
.ai-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ai-head b { margin-right: auto; font-weight: 600; }
.ai-badge { font: 600 11px var(--f-display); letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
.ai-out { display: grid; gap: 6px; font-size: 13.5px; min-width: 0; }
.ai-out ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.ai-text { white-space: pre-wrap; unicode-bidi: plaintext; }
.ai-link { all: unset; cursor: pointer; color: var(--accent); text-decoration: underline; unicode-bidi: isolate; }
.ai-link:focus-visible { outline: 2px solid var(--accent); }
.ai-match { grid-column: 1 / -1; }
.ai-chat { display: grid; gap: 10px; align-content: start; max-height: 62vh; overflow-y: auto; min-width: 0; }
.ai-msg { max-width: min(760px, 92%); padding: 9px 12px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; unicode-bidi: plaintext; min-width: 0; overflow-wrap: anywhere; }
.ai-msg.user { justify-self: end; background: var(--accent-weak); }
.ai-msg .small { white-space: normal; }
#ai-form textarea { resize: vertical; }`;
  document.head.appendChild(style);

  function offerFacts(o) {
    return { key: o.key, supplier: o.sup, name: o.name, details: o.detail || undefined, category: o.category || undefined, unit: o.extra.unit || undefined,
      listedPrice: o.price, discountPct: +o.disc || 0, piecesPerPack: o.pack, netPerPiece: r2(o.net), listDate: S.suppliers[o.sid]?.date };
  }
  function productFacts(p) {
    return { pid: p.pid, name: p.name, details: p.detail || undefined, category: p.category || undefined,
      offers: [...p.offers].sort((a, b) => a.net - b.net).map(o => { const { key, ...f } = offerFacts(o); return f; }),
      cheapest: p.best.sup, buyingFrom: p.buy.sup, cost: r2(p.cost), sellPrice: p.sell, marginPct: r2(p.margin * 100) };
  }
  function errText(e) {
    if (e?.code === 'not_granted') return 'Claude is not allowed on this page for you. Allow it from the page\'s Permissions menu, then try again.';
    if (e?.code === 'rate_limited') return 'Claude is busy right now. Try again in a minute.';
    return 'Claude could not answer this time. Try again.';
  }
  async function sampler() { const s = await sampleP; if (!s) throw { code: 'not_granted' }; return s; }
  // light formatting for Claude's text: **bold**, bullets, and [[pid|name]] as a link to the product
  function md(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#+\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-*] /gm, '• ')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (m, pid, name) => D.byPid[pid] ? `<button class="ai-link" data-open="${pid}">${name}</button>` : name);
  }
  // show an answer in its slot, if that slot is on screen
  function put(key, entry) {
    answers.set(key, entry);
    const slot = document.querySelector(`[data-ai-slot="${CSS.escape(key)}"]`);
    if (slot) slot.innerHTML = entry.view();
  }
  const head = (title, btn) => `<div class="ai-head"><span class="ai-badge">Claude</span><b>${title}</b>${btn}</div>`;

  // ---------- product: what is it, same product?, which offer is better value ----------
  function productBox(p) { return `<div class="ai" data-ai-slot="${esc('p:' + p.pid)}">${productInner(p)}</div>`; }
  function productInner(p) {
    const a = answers.get('p:' + p.pid);
    const top = head('Understand this product', a?.state === 'busy' ? '' : `<button class="btn small" data-ai-product="${esc(p.pid)}">${a ? 'Ask again' : 'Ask Claude'}</button>`);
    if (!a) return top + `<p class="small muted">Claude explains what this item is, whether the suppliers' items are really the same product, and which offer is the better value per piece.</p>`;
    if (a.state === 'busy') return top + `<p class="small muted">Claude is reading the supplier offers…</p>`;
    if (a.state === 'error') return top + `<p class="small warn-text">${esc(a.error)}</p>`;
    const r = a.data || {};
    const offers = (Array.isArray(r.offers) ? r.offers : []).map(x => {
      const o = p.offers.find(o => o.key === x.key); if (!o) return '';
      const n = Math.round(+x.packGuess), canSet = n >= 1 && n !== o.pack;
      return `<li><b>${esc(o.sup)}:</b> <span class="ar">${md(x.note || '')}</span>${canSet ? ` <button class="btn small" data-ai-pack="${esc(o.key)}" data-n="${n}" data-for="${esc(p.pid)}">Set ${n} per pack</button>${x.packWhy ? ` <span class="small muted">${md(x.packWhy)}</span>` : ''}` : ''}</li>`;
    }).join('');
    const same = { yes: ['best', 'Same product'], no: ['warn', 'Not the same product'], unsure: ['', 'Not sure it is the same'] }[r.same];
    return top + `<div class="ai-out">
      ${r.what ? `<p class="ai-text">${md(r.what)}</p>` : ''}
      ${p.offers.length > 1 && same ? `<p><span class="chip ${same[0]}">${same[1]}</span> ${md(r.sameWhy || '')}</p>` : ''}
      ${offers ? `<ul>${offers}</ul>` : ''}
      ${r.best ? `<p><b>Best value:</b> ${md(r.best)}</p>` : ''}
      ${Array.isArray(r.warnings) && r.warnings.length ? `<ul class="warn-text">${r.warnings.map(w => `<li>${md(String(w))}</li>`).join('')}</ul>` : ''}
      <p class="small muted">This is Claude's reading of the price lists. Check it before you change anything.</p></div>`;
  }
  async function askProduct(pid) {
    const p = D.byPid[pid], key = 'p:' + pid; if (!p || answers.get(key)?.state === 'busy') return;
    const view = () => productInner(D.byPid[pid] || p);
    put(key, { state: 'busy', view });
    const prompt = `${ROLE}

One product and every supplier's offer for it (JSON). Suppliers are compared on ${settings().perPiece ? 'net price per piece' : 'the listed price'}.
${JSON.stringify({ product: p.name, details: p.detail || undefined, category: p.category || undefined, offers: p.offers.map(offerFacts) })}

Reply with JSON only, in this shape:
{"what": "1-2 sentences: what this item is and what it is used for, judging from its name",
 "same": "yes" or "no" or "unsure": are all the offers the same product (size, type, brand)? "yes" when there is only one offer,
 "sameWhy": "one sentence",
 "offers": [{"key": "the offer's key", "note": "one short sentence: brand, size, and what the listed price most likely covers", "packGuess": the pieces per pack the listed price most likely covers, or null when the current piecesPerPack looks right or you can't tell, "packWhy": "short reason, only when packGuess is set"}],
 "best": "which offer is the better value per piece and by how much, or why they can't be compared",
 "warnings": ["anything that looks wrong, such as a price that is probably for a box"]}`;
    try { put(key, { state: 'done', data: await (await sampler()).json(prompt, { modelTier: 'default' }), view }); }
    catch (e) { console.error(e); put(key, { state: 'error', error: errText(e), view }); }
  }

  // ---------- matching: is this suggested pair the same product? ----------
  const matchButton = s => `<button class="btn small" data-ai-match="${esc(s.pk)}">Ask Claude</button>`;
  const matchResult = s => `<div class="ai-match" data-ai-slot="${esc('m:' + s.pk)}">${matchInner(s.pk)}</div>`;
  function matchInner(pk) {
    const a = answers.get('m:' + pk);
    if (!a) return '';
    if (a.state === 'busy') return `<p class="small muted">Claude is checking these two items…</p>`;
    if (a.state === 'error') return `<p class="small warn-text">${esc(a.error)}</p>`;
    const r = a.data || {}, v = { same: ['best', 'Claude: same product'], different: ['warn', 'Claude: different products'] }[r.verdict] || ['', 'Claude: not sure'];
    return `<div class="ai-out small"><p><span class="chip ${v[0]}">${v[1]}</span> ${md(r.why || '')}</p>${r.note ? `<p class="muted">${md(r.note)}</p>` : ''}</div>`;
  }
  async function askMatch(pk) {
    const s = suggestions().find(x => x.pk === pk), key = 'm:' + pk; if (!s || answers.get(key)?.state === 'busy') return;
    const view = () => matchInner(pk);
    put(key, { state: 'busy', view });
    const side = p => ({ name: p.name, details: p.detail || undefined, offers: p.offers.map(o => { const { key, ...f } = offerFacts(o); return f; }) });
    const prompt = `${ROLE}

Two items from different suppliers whose names look alike (JSON). Decide if they are the same product: same type, size and brand where a brand is named. Different spellings, word order, Arabic/English and digit styles don't matter.
${JSON.stringify({ itemA: side(s.a), itemB: side(s.b) })}

Reply with JSON only: {"verdict": "same" or "different" or "unsure", "why": "one or two sentences", "note": "anything about pack sizes or prices to check before linking them, or an empty string"}`;
    try { put(key, { state: 'done', data: await (await sampler()).json(prompt, { modelTier: 'default' }), view }); }
    catch (e) { console.error(e); put(key, { state: 'error', error: errText(e), view }); }
  }

  // ---------- compare: explain the grid on screen ----------
  let grid = null;
  const compareKey = q => 'c:' + norm(q) + (S.cmulti ? ':multi' : '');
  function compareBox(q, rows, cols) {
    grid = { q, rows, cols };
    const key = compareKey(q);
    return `<div class="ai" data-ai-slot="${esc(key)}">${compareInner(key)}</div>`;
  }
  function compareInner(key) {
    const a = answers.get(key);
    const top = head('Explain this comparison', a?.state === 'busy' ? '' : `<button class="btn small" data-ai-compare="${esc(key)}">${a ? 'Ask again' : 'Ask Claude'}</button>`);
    if (!a) return top + `<p class="small muted">Claude sums up who is cheapest for each size, and points out prices that look like a box or a different product.</p>`;
    if (a.state === 'error') return top + `<p class="small warn-text">${esc(a.error)}</p>`;
    return top + `<div class="ai-out"><div class="ai-text">${a.text ? md(a.text) : '<span class="muted">Claude is reading the grid…</span>'}</div></div>`;
  }
  async function askCompare(key) {
    if (!grid || compareKey(grid.q) !== key || answers.get(key)?.state === 'busy') return;
    const view = () => compareInner(key);
    let left = 220; // offers sent at most, so a very wide search stays a reasonable size
    const rows = grid.rows.map(r => {
      const os = r.os.slice(0, Math.max(0, left)); left -= os.length;
      return { size: r.size || 'no size in the name', offers: os.map(o => { const { key, ...f } = offerFacts(o); return f; }) };
    }).filter(r => r.offers.length);
    put(key, { state: 'busy', text: '', view });
    const prompt = `${ROLE}

The Compare grid for the search "${grid.q}": one row per size, with every supplier's offers (JSON). Suppliers: ${grid.cols.map(c => c.name).join(', ')}.
${JSON.stringify(rows)}

In under 180 words, as short bullet points: who is cheapest per piece for each size (or group of sizes), which supplier is cheapest overall, any price that looks like a box or a different product rather than one piece, and sizes only one supplier sells. No preamble.`;
    try {
      const res = await (await sampler())(prompt, { modelTier: 'default', onText: u => put(key, { state: 'busy', text: u.text, view }) });
      put(key, { state: 'done', text: res.text, view });
    } catch (e) { console.error(e); put(key, { state: 'error', error: errText(e), view }); }
  }

  // ---------- Ask Claude tab: questions about the price lists, answered with search tools ----------
  const chat = { msgs: [], busy: false, status: '', ctl: null };
  const EXAMPLES = ['Which supplier is cheapest for شاش overall?', 'Which products have the biggest price gap between suppliers?', 'Which prices look like they are for a box, not one piece?'];
  function chatHtml() {
    if (!chat.msgs.length) return `<p class="muted small">Ask anything about your supplier lists. Claude searches them to answer and links the products it mentions. Try one of these:</p>
      <div class="row">${EXAMPLES.map((x, i) => `<button class="btn small ar" data-ai-example="${i}">${esc(x)}</button>`).join('')}</div>`;
    return chat.msgs.map(m => `<div class="ai-msg ${m.role}">${m.role === 'user' ? esc(m.content) : m.content ? md(m.content) : `<span class="muted">${esc(chat.status || 'Claude is thinking…')}</span>`}${m.error ? `<div class="small warn-text">${esc(m.error)}</div>` : ''}</div>`).join('');
  }
  function renderAsk(v) {
    v.innerHTML = `<div class="panel"><h2>Ask Claude about your prices</h2>
      <div class="ai-chat" id="ai-chat">${chatHtml()}</div>
      <form class="row" id="ai-form"><textarea class="grow ar" id="ai-q" rows="2" placeholder="e.g. Who sells جاون 7.5 cheapest per piece?" aria-label="Your question"></textarea>
        <button class="btn primary" id="ai-send" ${chat.busy ? 'disabled' : ''}>Ask</button>${chat.msgs.length ? '<button type="button" class="btn" id="ai-new">New conversation</button>' : ''}</form>
      <p class="small muted">Claude reads your lists to answer and can make mistakes. Open a product to check its prices before you act on an answer.</p></div>`;
    const box = $('#ai-chat'); box.scrollTop = box.scrollHeight;
    const q = $('#ai-q');
    $('#ai-form').onsubmit = e => { e.preventDefault(); sendChat(q.value); };
    q.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(q.value); } };
    if ($('#ai-new')) $('#ai-new').onclick = () => { chat.ctl?.abort(); chat.msgs = []; chat.busy = false; render(); };
  }
  function refreshChat() { const box = $('#ai-chat'); if (!box) return; box.innerHTML = chatHtml(); box.scrollTop = box.scrollHeight; }
  const TOOLS = [
    { name: 'search_products', description: 'Searches the products in the price lists. Every word of the query must appear in the name, details or category (Arabic spelling is normalised). Returns {total, products} with each supplier\'s offer, net price per piece, cost and sell price.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Short words, usually Arabic, e.g. "شاش" or "جاون 7.5". Empty for all products.' },
        supplier: { type: 'string', description: 'Only products this supplier sells (part of its name).' },
        onlyMultiSupplier: { type: 'boolean', description: 'Only products sold by 2 or more suppliers.' },
        sort: { type: 'string', enum: ['name', 'cheapest', 'biggestGap'], description: 'biggestGap: largest difference between the cheapest and dearest supplier per piece first.' },
        limit: { type: 'number', description: 'At most 40, default 20.' } } },
      execute: ({ query = '', supplier = '', onlyMultiSupplier = false, sort = 'name', limit = 20 }) => {
        chat.status = 'Searching the price lists…'; refreshChat();
        const sup = norm(supplier);
        let list = D.products.filter(p => (!onlyMultiSupplier || p.nSup > 1) && (!sup || p.offers.some(o => norm(o.sup).includes(sup))) && (!String(query).trim() || matches(p.name + ' ' + p.detail + ' ' + p.category + ' ' + p.offers.map(o => o.name).join(' '), String(query))));
        const by = { cheapest: (a, b) => a.best.net - b.best.net, biggestGap: (a, b) => (b.high.net - b.best.net) - (a.high.net - a.best.net) }[sort];
        if (by) list = list.sort(by);
        return { total: list.length, products: list.slice(0, Math.min(40, Math.max(1, +limit || 20))).map(productFacts) };
      } },
    { name: 'list_suppliers', description: 'Lists the suppliers with their item counts, list dates and how many of their items are matched with another supplier.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => supplierOrder().map(s => ({ name: s.name, items: D.offers.filter(o => o.sid === s.id).length, listDate: s.date, matchedWithOthers: D.products.filter(p => p.nSup > 1 && p.offers.some(o => o.sid === s.id)).length })) },
  ];
  async function sendChat(text) {
    text = String(text || '').trim(); if (!text || chat.busy) return;
    chat.msgs.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
    chat.busy = true; chat.status = ''; render();
    const reply = chat.msgs[chat.msgs.length - 1];
    const ctl = chat.ctl = new AbortController();
    const st = settings();
    const intro = `${ROLE}
You are answering questions inside the team's price comparison app. There are ${D.products.length} products from ${Object.keys(S.suppliers).length} suppliers (${supplierOrder().map(s => s.name).join(', ')}). Prices are in ${st.currency}; sell prices use a ${st.mode === 'margin' ? 'margin on the sale price' : 'markup on cost'}.
Use the tools to look things up; never guess prices. Search with short words, and try other spellings or the Arabic word when a search finds nothing. When you mention a product, write it as [[pid|name]] using the pid from the tools, so it becomes a link. Answer briefly, with short bullet points where they help.

Question: `;
    const input = chat.msgs.slice(0, -1).map((m, i) => ({ role: m.role, content: i === 0 ? intro + m.content : m.content || '(no answer)' }));
    try {
      const sample = await sampler();
      if (!(await sample.limits()).tools) throw { code: 'no_tools' };
      const res = await sample(input, { tools: TOOLS, signal: ctl.signal, modelTier: 'default', cache: false, onText: u => { reply.content = u.text; chat.status = ''; refreshChat(); } });
      reply.content = res.text;
    } catch (e) {
      if (ctl.signal.aborted) return;
      console.error(e);
      reply.error = e?.code === 'no_tools' ? 'Claude cannot search your lists from this view. Open the page in claude.ai in a browser and try again.' : errText(e);
    }
    if (chat.ctl !== ctl) return;
    chat.busy = false; chat.status = '';
    if (S.tab === 'ask') render();
  }

  // ---------- scanned price lists and photos ----------
  async function readScan(canvas) {
    const sample = await sampler();
    if (!(await sample.limits()).images) throw new Error('Claude cannot read images in this view');
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', 0.88));
    const out = await sample.json(`Read this page of a supplier's price list. Return JSON only: {"rows": [{"name": "the item name exactly as printed, Arabic kept as it is", "price": the item's price as a number (the main price column; read Arabic-Indic digits ٠-٩ as numbers; null if you can't read it), "detail": "other useful columns for the item joined with ' · ', such as size, pack or 'خصم: 10', or empty", "category": "the section heading the item sits under, or empty"}]}. One row per item, in page order. Skip headings, column titles, totals, dates and page numbers.`, { images: [blob], modelTier: 'default' });
    return (Array.isArray(out?.rows) ? out.rows : []).map(r => ({
      name: String(r.name ?? '').trim(),
      price: typeof r.price === 'number' ? r.price : TableReader.parsePrice(String(r.price ?? '')),
      detail: String(r.detail ?? '').trim(), category: String(r.category ?? '').trim(),
    })).filter(r => r.name);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.aiProduct) askProduct(d.aiProduct);
    else if (d.aiMatch) askMatch(d.aiMatch);
    else if (d.aiCompare) askCompare(d.aiCompare);
    else if (d.aiExample != null) sendChat(EXAMPLES[+d.aiExample]);
    else if (d.aiPack) {
      S.packs[d.aiPack] = { ...(S.packs[d.aiPack] || {}), pack: +d.n };
      savePack(d.aiPack); changed(); openProduct(d.for); toast(`Set to ${d.n} pieces per pack`);
    }
  });

  window.SPD_AI = { productBox, matchButton, matchResult, compareBox, renderAsk, readScan };
})();
