// Reads a PDF or a photo of a price list into rows, all inside the browser.
// PDF pages with a usable text layer are read directly; scanned or broken pages go through OCR.
(function (root) {
  const TESS = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_best_int',
  };
  let textWorker = null, digitWorker = null;
  async function workers() {
    if (!textWorker) {
      textWorker = await Tesseract.createWorker('ara+eng', 1, TESS);
      await textWorker.setParameters({ preserve_interword_spaces: '1' });
    }
    if (!digitWorker) {
      digitWorker = await Tesseract.createWorker('eng', 1, TESS);
      await digitWorker.setParameters({ tessedit_char_whitelist: '0123456789.,', tessedit_pageseg_mode: '6' });
    }
    return { textWorker, digitWorker };
  }
  async function release() {
    await Promise.all([textWorker?.terminate(), digitWorker?.terminate()]);
    textWorker = digitWorker = null;
  }

  // OCR one canvas: words for names, then each price column again with a digits-only reader.
  async function ocrCanvas(canvas, state) {
    const { textWorker, digitWorker } = await workers();
    const { data } = await textWorker.recognize(canvas);
    const { rows, priceBands } = TableReader.readPieces(TableReader.piecesFromOcr(data.lines), state, { useHeader: false });
    for (const band of priceBands) {
      const tableRows = rows.filter(r => r.priceCol === band);
      if (!tableRows.length) continue;
      const w = band.x1 - band.x0, x0 = Math.max(0, Math.floor(band.x0 - w * 0.6)), x1 = Math.min(canvas.width, Math.ceil(band.x1 + w * 0.6));
      const y0 = Math.max(0, Math.floor(Math.min(...tableRows.map(r => r.y)) - 30));
      const y1 = Math.min(canvas.height, Math.ceil(Math.max(...tableRows.map(r => r.y)) + 30));
      const { data: d } = await digitWorker.recognize(canvas, { rectangle: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } });
      const nums = d.words.map(wd => ({ v: TableReader.parsePrice(wd.text), y: (wd.bbox.y0 + wd.bbox.y1) / 2, h: wd.bbox.y1 - wd.bbox.y0 })).filter(n => !isNaN(n.v));
      for (const r of tableRows) {
        const hit = nums.filter(n => Math.abs(n.y - r.y) < Math.max(10, n.h * 0.8)).sort((a, b) => Math.abs(a.y - r.y) - Math.abs(b.y - r.y))[0];
        if (hit) r.price = hit.v;
      }
    }
    return rows;
  }

  function canvasFor(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); return c; }

  async function imageCanvas(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(3, Math.max(1, 2400 / bmp.width));
    const c = canvasFor(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  const footKey = (name, y) => name.replace(/[\d٠-٩]+/g, '#') + '@' + Math.round(y / 4);
  async function repeatedLines(pdf) {
    const n = Math.min(pdf.numPages, 4), seen = new Map(), out = new Set();
    if (n < 3) return out;
    const state = {};
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i), h = page.getViewport({ scale: 1 }).height;
      const pieces = TableReader.piecesFromPdf(await page.getTextContent(), h);
      if (TableReader.looksBroken(pieces)) return out;
      const keys = new Set(TableReader.readPieces(pieces, state).rows.map(r => footKey(r.name, r.y)));
      keys.forEach(k => seen.set(k, (seen.get(k) || 0) + 1));
    }
    for (const [k, c] of seen) if (c >= n) out.add(k);
    return out;
  }

  // onPage({n, total, mode, rows}) is called as each page finishes.
  // readScan(canvas) -> rows, when given, reads scanned pages and photos instead of the OCR here.
  async function readFile(file, { onPage, forceOcr = false, signal, readScan } = {}) {
    const all = [], state = {};
    const scan = readScan || (c => ocrCanvas(c, state));
    try {
      if (file.type.startsWith('image/')) {
        const rows = await scan(await imageCanvas(file));
        rows.forEach(r => all.push({ ...r, page: 1 }));
        onPage?.({ n: 1, total: 1, mode: 'scan', rows });
        return all;
      }
      // isEvalSupported off, so a crafted PDF cannot run code through its fonts (pdf.js 3.x security advisory)
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      // a footer (date, page number) repeats at the same spot on every page; read a few pages to learn it
      const footers = await repeatedLines(pdf);
      const isFooter = r => footers.has(footKey(r.name, r.y));
      for (let n = 1; n <= pdf.numPages; n++) {
        if (signal?.aborted) break;
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const pieces = TableReader.piecesFromPdf(await page.getTextContent(), base.height);
        let rows, mode = 'text';
        if (!forceOcr && !TableReader.looksBroken(pieces)) {
          rows = TableReader.readPieces(pieces, state).rows;
          // rows whose price can't be read stay in, so the review table can flag them; a page with no prices at all is scanned
          if (!rows.some(r => !isNaN(r.price))) rows = null;
        }
        if (!rows || !rows.length) {
          mode = 'scan';
          const vp = page.getViewport({ scale: 2400 / base.width });
          const c = canvasFor(Math.round(vp.width), Math.round(vp.height));
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          rows = await scan(c);
        }
        rows = rows.filter(r => !isFooter(r));
        rows.forEach(r => all.push({ ...r, page: n }));
        onPage?.({ n, total: pdf.numPages, mode, rows });
      }
      return all;
    } finally { await release(); }
  }

  root.PdfImport = { readFile };
})(window);
