// Shared set-up for the browser tests: serves the site from this folder at http://desk.test/,
// swaps Firebase and the OCR library for local stand-ins, and serves the Excel and PDF readers
// from node_modules (the tests run without internet).
const { test: base, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '../..');
const NM = path.join(ROOT, 'node_modules');
const ORIGIN = 'http://desk.test';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
const js = body => ({ status: 200, contentType: 'application/javascript', body });
const file = p => ({ status: 200, contentType: TYPES[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });

// One supplier's rows in the site's stored form. A row is [name, price, detail, source, category, prev, extra].
function itemsDocs(sid, rows) {
  const docs = {};
  for (let c = 0; c * 500 < rows.length; c++) {
    docs[`items/${sid}-${c}`] = {
      rows: rows.slice(c * 500, c * 500 + 500).map(([n, p, d, s, cat, o, x]) => Object.assign({ n, p, d: d || '', s: s || '', c: cat || '' }, o ? { o } : {}, x ? { x } : {})),
    };
  }
  return docs;
}
// seed({suppliers: [{id, name, rows, ...}], links, dismissed, products, settings, quotes}) -> Firestore docs
function seed({ suppliers = [], links, dismissed, products = {}, settings, quotes = {} } = {}) {
  const docs = {};
  suppliers.forEach(({ id, name, rows, ...rest }, i) => {
    docs['suppliers/' + id] = { name, file: id + '.xlsx', date: '2026-10-01', chunks: Math.ceil(rows.length / 500), order: i, ...rest };
    Object.assign(docs, itemsDocs(id, rows));
  });
  if (links) docs['matching/links'] = { map: links };
  if (dismissed) docs['matching/dismissed'] = { map: dismissed };
  for (const [pid, ov] of Object.entries(products)) docs['products/' + pid] = ov;
  if (settings) docs['settings/main'] = settings;
  for (const [id, q] of Object.entries(quotes)) docs['quotes/' + id] = q;
  return docs;
}

const test = base.extend({
  // open the site; options: {user, team, docs, unconfigured, noFirebase, ocrRows}
  openApp: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e));
    await use(async (opts = {}) => {
      await page.addInitScript(o => {
        window.__FAKE = { user: o.user, team: o.team, docs: o.docs };
        window.__OCR_ROWS = o.ocrRows;
      }, { user: opts.user, team: opts.team, docs: opts.docs || {}, ocrRows: opts.ocrRows });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(ORIGIN)) {
          const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html';
          if (rel === 'firebase-config.js' && opts.unconfigured) return route.fulfill(js('window.FIREBASE_CONFIG = { apiKey: "PASTE-YOUR-API-KEY" };'));
          const p = path.join(ROOT, rel);
          return fs.existsSync(p) && p.startsWith(ROOT) ? route.fulfill(file(p)) : route.fulfill({ status: 404, body: '' });
        }
        if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        if (url.includes('/xlsx-0.20.3/package/dist/xlsx.full.min.js')) return route.fulfill(file(path.join(NM, 'xlsx/dist/xlsx.full.min.js')));
        if (url.includes('/pdf.js/3.11.174/pdf.worker.min.js')) return route.fulfill(file(path.join(NM, 'pdfjs-dist/build/pdf.worker.min.js')));
        if (url.includes('/pdf.js/3.11.174/pdf.min.js')) return route.fulfill(file(path.join(NM, 'pdfjs-dist/build/pdf.min.js')));
        if (url.includes('tesseract.min.js')) return route.fulfill(file(path.join(__dirname, 'fake-tesseract.js')));
        if (url.includes('firebase-app-compat.js')) return opts.noFirebase ? route.abort() : route.fulfill(file(path.join(__dirname, 'fake-firebase.js')));
        if (url.includes('gstatic.com/firebasejs/')) return opts.noFirebase ? route.abort() : route.fulfill(js(''));
        return route.abort();
      });
      await page.goto(ORIGIN + '/');
      return page;
    });
    expect(errors.map(String), 'no uncaught errors in the page').toEqual([]);
  },
});

// helpers used across specs
const app = {
  tab: (page, name) => page.locator(`#tabs button[data-tab="${name}"]`).click(),
  ready: page => expect(page.locator('#sub')).toContainText('products from'),
  store: page => page.evaluate(() => window.__fake.store),
  doc: (page, p) => page.evaluate(p => window.__fake.doc(p), p),
  // write a workbook to a temp file and return its path; rows is an array of arrays
  xlsxFile(testInfo, name, rows, sheet = 'Sheet1') {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
    const p = testInfo.outputPath(name);
    XLSX.writeFile(wb, p);
    return p;
  },
  textFile(testInfo, name, content) { const p = testInfo.outputPath(name); fs.writeFileSync(p, content); return p; },
  // read a downloaded workbook as arrays of rows
  async download(page, click) {
    const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
    const p = await dl.path();
    const wb = XLSX.read(fs.readFileSync(p));
    return { name: dl.suggestedFilename(), wb, rows: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }), text: () => fs.readFileSync(p, 'utf8') };
  },
  toast: page => page.locator('#toast'),
};

module.exports = { test, expect, seed, app, ORIGIN };
