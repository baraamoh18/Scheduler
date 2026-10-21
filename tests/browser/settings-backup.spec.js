// Settings: pricing rules, margins by category, your own columns, and backup download / load.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');

const sell = (page, text) => page.locator('#view tbody tr', { hasText: text }).locator('td.sell');
async function start(openApp, page, extra = {}) {
  await openApp({ docs: seed({ suppliers: [nile, delta], ...extra }) });
  await app.ready(page);
}
async function setField(page, sel, value) {
  const el = page.locator(sel);
  if (await el.evaluate(e => e.tagName) === 'SELECT') await el.selectOption(String(value));
  else { await el.fill(String(value)); await el.press('Tab'); }
  // each change redraws the settings on the next frame; typing before that would land in the old box
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('pricing rules: default margin, margin on sale price, rounding, currency and company', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'settings');
  await setField(page, '#st-m', 25);
  await setField(page, '#st-mode', 'margin');
  await setField(page, '#st-cur', 'EGP');
  await setField(page, '#st-co', 'Omega Medical');
  await expect.poll(async () => await app.doc(page, 'settings/main')).toEqual({ defaultMargin: 0.25, mode: 'margin', currency: 'EGP', company: 'Omega Medical' });
  await app.tab(page, 'products');
  await expect(page.locator('.stat').nth(2)).toContainText('25%default margin on sale price');
  await expect(sell(page, 'رباط ضاغط 10 سم')).toHaveText('20.00'); // 15 / (1 - 0.25)
  await app.tab(page, 'settings');
  await setField(page, '#st-mode', 'markup');
  await setField(page, '#st-round', 5);
  await app.tab(page, 'products');
  await expect(sell(page, 'رباط ضاغط 10 سم')).toHaveText('20.00'); // 18.75 rounded up to 20
  await expect(sell(page, 'سرنجة 5 مل')).toHaveText('5.00');
  await app.tab(page, 'settings');
  await setField(page, '#st-round', 0.25);
  await app.tab(page, 'products');
  await expect(sell(page, 'سرنجة 5 مل')).toHaveText('3.25'); // 3.125 up to 3.25
  // an empty currency goes back to ج.م
  await app.tab(page, 'settings');
  await setField(page, '#st-cur', '');
  await expect(page.locator('#st-cur')).toHaveValue('ج.م');
});

test('a margin of 100% or more on sale price shows no price rather than a wrong one', async ({ page, openApp }) => {
  await start(openApp, page, { settings: { mode: 'margin', defaultMargin: 1 } });
  await expect(sell(page, 'سرنجة 5 مل')).toHaveText('–');
});

test('margins: a product margin beats its category margin, which beats the default', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'settings');
  const row = page.locator('#view tbody tr', { hasText: 'شاش' });
  await expect(row.locator('td.num').first()).toHaveText('2');
  await row.locator('[data-catm]').fill('50');
  await row.locator('[data-catm]').press('Tab');
  await expect.poll(async () => (await app.doc(page, 'settings/main')).catMargins).toEqual({ 'شاش': 0.5 });
  await app.tab(page, 'products');
  await expect(sell(page, 'شاش طبي 7.5 سم')).toHaveText('27.00'); // 18 + 50%
  await expect(sell(page, 'رباط ضاغط 10 سم')).toHaveText('18.00'); // no category: default 20%
  const r = page.locator('#view tbody tr', { hasText: 'شاش طبي 7.5 سم' });
  await r.locator('input.margin').fill('10');
  await r.locator('input.margin').press('Tab');
  await expect(sell(page, 'شاش طبي 7.5 سم')).toHaveText('19.80');
  // clearing the category margin goes back to the default
  await app.tab(page, 'settings');
  await row.locator('[data-catm]').fill('');
  await row.locator('[data-catm]').press('Tab');
  await expect.poll(async () => (await app.doc(page, 'settings/main')).catMargins).toEqual({});
});

test('no categories yet shows a hint', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [{ id: 'd', name: 'D', rows: [['شاش', 1]] }] }) });
  await app.ready(page);
  await app.tab(page, 'settings');
  await expect(page.locator('#view')).toContainText('No categories yet.');
  await expect(page.locator('#view')).toContainText('None yet. When you upload a list');
});

test('your columns: rename everywhere, and remove with a second click', async ({ page, openApp }) => {
  const sup = { id: 's', name: 'S', rows: [['شاش', 10, '', '', '', 0, { f1: '12', unit: 'علبة' }], ['قطن', 5, '', '', '', 0, { f1: '6' }]] };
  await openApp({ docs: seed({ suppliers: [sup], settings: { fields: { f1: { name: 'تجاري', order: 0 } } } }) });
  await app.ready(page);
  await expect(page.locator('#view thead')).toContainText('تجاري');
  await app.tab(page, 'settings');
  await expect(page.locator('#view tbody tr', { has: page.locator('[data-fren]') }).locator('td.num')).toHaveText('2');
  await page.locator('[data-fren="f1"]').fill('صيدلي');
  await page.locator('[data-fren="f1"]').press('Tab');
  await expect.poll(async () => (await app.doc(page, 'settings/main')).fields.f1.name).toBe('صيدلي');
  // an empty name is not saved
  await page.locator('[data-fren="f1"]').fill('');
  await page.locator('[data-fren="f1"]').press('Tab');
  await expect(page.locator('[data-fren="f1"]')).toHaveValue('صيدلي');
  await app.tab(page, 'products');
  await expect(page.locator('#view thead')).toContainText('صيدلي');
  await expect(page.locator('#view tbody tr', { hasText: 'شاش' }).locator('.det')).toHaveText('علبة');
  await app.tab(page, 'settings');
  const del = page.locator('[data-fdel="f1"]');
  await del.click();
  await expect(del).toHaveText('Click again');
  await del.click();
  await expect(app.toast(page)).toHaveText('Column removed');
  await expect.poll(async () => (await app.doc(page, 'settings/main')).fields).toEqual({});
  await app.tab(page, 'products');
  await expect(page.locator('#view thead')).not.toContainText('صيدلي');
});

test('backup: download everything, then load it into an empty database', async ({ page, openApp }, info) => {
  const quotes = { 'q-1': { customer: 'C', date: '2026-10-01', notes: '', lines: [{ pid: 'x', qty: 1, price: 5, manual: true, name: 'n', detail: '' }], updated: '2026-10-01T00:00:00Z' } };
  await start(openApp, page, { settings: { defaultMargin: 0.3 }, quotes, products: { 'o-nile-abc-1': { name: 'Renamed' } } });
  await app.tab(page, 'matching');
  await page.locator('.match-row', { hasText: 'سرنجة' }).getByRole('button', { name: 'Same product' }).click();
  await app.tab(page, 'settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#bk-get').click()]);
  expect(dl.suggestedFilename()).toMatch(/^Supply Price Desk backup \d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  expect(backup.app).toBe('supply-price-desk');
  expect(Object.keys(backup.docs).sort()).toEqual(['items/delta-0', 'items/nile-0', 'matching/dismissed', 'matching/links', 'matching/packs', 'products/o-nile-abc-1', 'quotes/q-1', 'settings/main', 'suppliers/delta', 'suppliers/nile']);
  expect(backup.docs['items/nile-0'].rows[0]).toEqual(['شاش طبي 10 سم × 10 سم', 25, '', 'row 2', 'شاش', null, null]);
  const file = info.outputPath('backup.json');
  require('fs').writeFileSync(file, JSON.stringify(backup));

  // start again with an empty database and load the file
  await page.evaluate(() => sessionStorage.setItem('__fakeFirestore', '{}'));
  await page.reload();
  await expect(page.locator('#view h2')).toHaveText('No price lists yet');
  await app.tab(page, 'settings');
  await page.setInputFiles('#bk-put', file);
  await expect(app.toast(page)).toHaveText('Backup loaded');
  await expect(page.locator('#sub')).toHaveText('10 products from 2 suppliers');
  await expect.poll(async () => await app.doc(page, 'settings/main')).toEqual({ defaultMargin: 0.3 });
  await expect.poll(async () => Object.keys((await app.doc(page, 'matching/links')).map)).toHaveLength(1);
  await app.tab(page, 'quote');
  await expect(page.locator('#view')).toContainText('Saved quotes');
});

test('loading a backup keeps matches made here and adds the backup\'s', async ({ page, openApp }, info) => {
  await start(openApp, page, { links: { 'here:1': 'p-here' } });
  const file = app.textFile(info, 'b.json', JSON.stringify({ app: 'supply-price-desk', version: 1, docs: { 'matching/links': { map: { 'there:1': 'p-there' } }, 'bad/path/x': { a: 1 } } }));
  await app.tab(page, 'settings');
  await page.setInputFiles('#bk-put', file);
  await expect(app.toast(page)).toHaveText('Backup loaded');
  await expect.poll(async () => (await app.doc(page, 'matching/links')).map).toEqual({ 'here:1': 'p-here', 'there:1': 'p-there' });
  await expect.poll(async () => Object.keys(await app.store(page)).some(k => k.startsWith('bad/'))).toBe(false);
});

test('loading a backup whose rows are stored as objects works too', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  const docs = seed({ suppliers: [nile] });
  const file = app.textFile(info, 'objects.json', JSON.stringify({ app: 'supply-price-desk', version: 1, docs }));
  await app.tab(page, 'settings');
  await page.setInputFiles('#bk-put', file);
  await expect(app.toast(page)).toHaveText('Backup loaded');
  await expect(page.locator('#sub')).toHaveText('6 products from 1 suppliers');
});

test('a file that is not a backup is refused', async ({ page, openApp }, info) => {
  await start(openApp, page);
  await app.tab(page, 'settings');
  await page.setInputFiles('#bk-put', app.textFile(info, 'x.json', '{"hello": 1}'));
  await expect(app.toast(page)).toHaveText('That file is not a Supply Price Desk backup.');
  await page.setInputFiles('#bk-put', app.textFile(info, 'y.json', 'not json'));
  await expect(app.toast(page)).toHaveText('That file is not a Supply Price Desk backup.');
});
