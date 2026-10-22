// The claude.ai copy of the site (dist/supply-price-desk.html, built by scripts/build-claude-page.js):
// the same app saving to claude.ai page storage instead of Firebase, plus Claude's help.
// window.claude is the in-memory stand-in from tests/support/fake-claude.js.
const { test: base, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');
const { build } = require('../../scripts/build-claude-page');

const ROOT = path.resolve(__dirname, '../..');
const NM = path.join(ROOT, 'node_modules');
const ORIGIN = 'http://claude-page.test';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let page_html;
base.beforeAll(() => { page_html = fs.readFileSync(build(), 'utf8'); });

const test = base.extend({
  openPage: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e));
    await use(async (cfg = {}) => {
      await page.addInitScript(c => { window.__CLAUDE = c; }, cfg);
      await page.addInitScript({ path: path.join(__dirname, '../support/fake-claude.js') });
      await page.route('**/*', route => {
        const url = route.request().url();
        const file = (p, type) => route.fulfill({ status: 200, contentType: type || 'application/javascript', body: fs.readFileSync(p) });
        // claude.ai serves the page inside its own skeleton
        if (url.startsWith(ORIGIN)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${page_html}</body></html>` });
        if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        if (url.includes('/ajax/libs/xlsx/0.18.5/xlsx.full.min.js')) return file(path.join(NM, 'xlsx/dist/xlsx.full.min.js'));
        if (url.includes('/pdf.js/3.11.174/pdf.worker.min.js')) return file(path.join(NM, 'pdfjs-dist/build/pdf.worker.min.js'));
        if (url.includes('/pdf.js/3.11.174/pdf.min.js')) return file(path.join(NM, 'pdfjs-dist/build/pdf.min.js'));
        return route.abort(); // nothing else may load: no Firebase, no OCR library
      });
      await page.goto(ORIGIN + '/');
      return page;
    });
    expect(errors.map(String), 'no uncaught errors in the page').toEqual([]);
  },
});
const store = page => page.evaluate(() => window.__claude.store);
const calls = page => page.evaluate(() => window.__claude.calls);
const start = async (openPage, page, cfg = {}) => { await openPage({ docs: seed({ suppliers: [nile, delta] }), ...cfg }); await app.ready(page); };

test('shows the saved price lists from claude.ai storage, with no Google sign-in', async ({ page, openPage }) => {
  await start(openPage, page);
  await expect(page.locator('#sub')).toHaveText('11 products from 2 suppliers');
  await expect(page.locator('#who')).toBeHidden();
  await expect(page.locator('#tab-ask')).toBeVisible();
});

test('someone signed out of claude.ai is told how to open it', async ({ page, openPage }) => {
  await openPage({ signedOut: true });
  await expect(page.locator('#view')).toContainText('Open Supply Price Desk in claude.ai');
});

test('a website backup loads, and later edits merge into the stored documents', async ({ page, openPage }, testInfo) => {
  await openPage({ docs: { 'settings/main': { defaultMargin: 0.2, catMargins: { 'شاش': 0.3 } } } });
  await expect(page.locator('#sub')).toContainText('0 products', { timeout: 20000 });
  const docs = seed({ suppliers: [nile, delta], links: {} });
  const file = testInfo.outputPath('backup.json');
  fs.writeFileSync(file, JSON.stringify({ app: 'supply-price-desk', version: 1, docs }));
  await app.tab(page, 'settings');
  await page.locator('#bk-put').setInputFiles(file);
  await expect(page.locator('#sub')).toHaveText('11 products from 2 suppliers');
  // clearing a category margin removes just that field; the rest of the settings stay
  // (wait for the settings to redraw with the loaded lists first, or the typing lands in the old box)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-catm]').first().fill('');
  await page.locator('[data-catm]').first().dispatchEvent('change');
  await expect.poll(async () => (await store(page))['settings/main']).toEqual({ defaultMargin: 0.2, catMargins: {} });
});

test('Ask Claude on a product explains it, and its pack size suggestion can be applied', async ({ page, openPage }) => {
  await start(openPage, page, { answers: { product: { what: 'Gauze swabs for wound care.', same: 'yes', sameWhy: 'Same size.', offers: [{ key: '$0', note: 'A pack of gauze', packGuess: 10, packWhy: 'The price fits a pack of 10.' }], best: 'Nile per piece.', warnings: ['The price may be for a box.'] } } });
  await page.locator('#view tbody td.pname button', { hasText: 'جاون عزل XL' }).click();
  await page.locator('#dlg [data-ai-product]').click();
  const box = page.locator('#dlg .ai');
  await expect(box).toContainText('Gauze swabs for wound care.');
  await expect(box).toContainText('The price may be for a box.');
  await box.getByRole('button', { name: 'Set 10 per pack' }).click();
  await expect(page.locator('#dlg')).toContainText('4.00'); // 40 for a pack of 10
  await expect(page.locator('#dlg .ai')).toContainText('Gauze swabs'); // the answer stays after the change
  const packs = (await store(page))['matching/packs'].map;
  expect(Object.values(packs)).toEqual([{ pack: 10 }]);
  expect((await calls(page))[0].input).toContain('جاون عزل XL');
});

test('Ask Claude checks a suggested match without linking anything', async ({ page, openPage }) => {
  await start(openPage, page, { answers: { match: { verdict: 'same', why: 'Both are 5 ml syringes.', note: '' } } });
  await app.tab(page, 'matching');
  const row = page.locator('.match-row', { hasText: 'سرنجة 5 مل' });
  await row.getByRole('button', { name: 'Ask Claude' }).click();
  await expect(row).toContainText('Claude: same product');
  await expect(row).toContainText('Both are 5 ml syringes.');
  expect((await store(page))['matching/links']).toBeUndefined();
});

test('Claude reviews the suggested pairs; the same ones can be linked and the different ones hidden', async ({ page, openPage }) => {
  await start(openPage, page, { answers: { review: { 'سرنج': 'same', 'رباط': 'different' } } });
  await app.tab(page, 'matching');
  const box = page.locator('#ai-review');
  await box.getByRole('button', { name: 'Check 3 with Claude' }).click();
  await expect(box).toContainText('1 same');
  await expect(box).toContainText('1 different');
  await expect(box).toContainText('1 not sure');
  await expect(box).toContainText('0 not checked');
  await expect(box.getByRole('button', { name: /Check \d+ with Claude/ })).toHaveCount(0); // nothing left to pay for
  await expect(page.locator('.match-row', { hasText: 'سرنجة 5 مل' })).toContainText('Claude: same product');
  expect(Object.values((await store(page))['matching/claude'].map).map(x => x.v).sort()).toEqual(['different', 'same', 'unsure']);
  expect((await calls(page)).filter(c => /^Each pair below/m.test(c.input))).toHaveLength(1); // one batch
  expect((await store(page))['matching/links']).toBeUndefined(); // nothing linked yet
  // filter by Claude's answer
  await page.locator('#ai-rv-filter').selectOption('same');
  await expect(page.locator('.match-row')).toHaveCount(1);
  await page.locator('#ai-rv-filter').selectOption('');
  // linking asks for a second click
  const link = box.getByRole('button', { name: 'Link the 1 Claude says are the same' });
  await link.click();
  await expect(box.getByRole('button', { name: 'Click again to link them' })).toBeVisible();
  await box.getByRole('button', { name: 'Click again to link them' }).click();
  await expect(page.locator('.match-row', { hasText: 'سرنجة 5 مل' })).toHaveCount(0);
  await expect.poll(async () => Object.keys((await store(page))['matching/links']?.map || {})).toHaveLength(1);
  await box.getByRole('button', { name: 'Hide the 1 Claude says are different' }).click();
  await box.getByRole('button', { name: 'Click again to hide them' }).click();
  await expect(page.locator('.match-row')).toHaveCount(1);
  await expect.poll(async () => Object.keys((await store(page))['matching/dismissed']?.map || {})).toHaveLength(1);
});

test('linking Claude\'s "same" pairs joins an item sold by three suppliers into one product', async ({ page, openPage }) => {
  const sup = (id, name) => ({ id, name, rows: [['كانيولا 22 ازرق', 6]] });
  await openPage({ docs: seed({ suppliers: [sup('x', 'X'), sup('y', 'Y'), sup('z', 'Z')] }), answers: { review: { 'كانيولا': 'same' } } });
  await app.ready(page);
  await app.tab(page, 'matching');
  const box = page.locator('#ai-review');
  await box.getByRole('button', { name: /Check \d+ with Claude/ }).click();
  await box.getByRole('button', { name: /Link the \d+ Claude says/ }).click();
  await box.getByRole('button', { name: 'Click again to link them' }).click();
  await expect(page.locator('#sub')).toHaveText('1 products from 3 suppliers');
});

test('Explain this comparison streams Claude\'s summary of the grid', async ({ page, openPage }) => {
  await start(openPage, page, { chatText: 'Nile is cheapest per piece on every size.' });
  await app.tab(page, 'compare');
  await page.locator('#cq').fill('شاش');
  await page.locator('[data-ai-compare]').click();
  await expect(page.locator('#view .ai')).toContainText('Nile is cheapest per piece on every size.');
  const sent = (await calls(page))[0].input;
  expect(sent).toContain('"search "شاش"'.slice(1));
  expect(sent).toContain('الدلتا للمستلزمات');
});

test('Ask Claude tab answers with the search tool and links the products it names', async ({ page, openPage }) => {
  await start(openPage, page, { toolCall: { name: 'search_products', input: { query: 'سرنجه', sort: 'cheapest' } }, chatText: 'Cheapest is ' });
  await app.tab(page, 'ask');
  await page.locator('#ai-q').fill('Who sells syringes cheapest?');
  await page.locator('#ai-send').click();
  const link = page.locator('.ai-msg.assistant .ai-link');
  await expect(link).toHaveText('سرنجة 5 مل');
  const c = (await calls(page))[0];
  expect(c.tools).toEqual(['search_products', 'list_suppliers']);
  expect(c.toolResult.total).toBe(2);
  await link.click();
  await expect(page.locator('#dlg')).toBeVisible();
  await expect(page.locator('#dlg h3.ar')).toHaveText('سرنجة 5 مل');
});

test('a photo of a price list is read by Claude and checked before importing', async ({ page, openPage }, testInfo) => {
  await start(openPage, page, { answers: { scan: { rows: [{ name: 'شاش معقم 5 سم', price: 12.5, detail: '', category: 'شاش' }, { name: 'لاصق طبي', price: '٧٫٥', detail: 'علبة', category: '' }] } } });
  await app.tab(page, 'suppliers');
  await page.locator('#im-name').fill('Photo supplier');
  const img = testInfo.outputPath('list.png'); fs.writeFileSync(img, PNG);
  await page.locator('#im-file').setInputFiles(img);
  await expect(page.locator('#im-map')).toContainText('2 rows found');
  await page.locator('#mp-go').click();
  await expect(page.locator('#sub')).toHaveText('13 products from 3 suppliers');
  expect((await calls(page))[0].images).toBe(1);
});

test('Excel files and backups are offered through claude.ai\'s save dialog', async ({ page, openPage }) => {
  await start(openPage, page);
  await page.locator('#exp-cust').click();
  await expect(app.toast(page)).toHaveText('Excel file downloaded');
  await app.tab(page, 'settings');
  await page.locator('#bk-get').click();
  await expect(app.toast(page)).toHaveText('Backup downloaded');
  const saved = await page.evaluate(() => window.__claude.saved);
  expect(saved.map(s => s.filename)).toEqual([expect.stringMatching(/^Price list .*\.xlsx$/), expect.stringMatching(/^Supply Price Desk backup .*\.json$/)]);
  expect(JSON.parse(saved[1].text).docs['suppliers/nile'].name).toBe('النيل الطبية');
});
