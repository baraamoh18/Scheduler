// Price per piece, guessed upload columns, cleaning up after a deleted list, rows without a price
// in PDFs, readers loaded on demand, the list date, delete buttons that reset, and margin limits.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');
const { priceListPdf } = require('../support/make-pdf');

const row = (page, text) => page.locator('#view tbody tr', { hasText: text });
const cost = (page, text) => row(page, text).locator('td.num').first();

test('price per piece: a discount column and a pack size decide the cheapest supplier', async ({ page, openApp }) => {
  // nile lists the syringe at 2.50 each; delta at 20 for a box of 10 with 20% off = 1.60 a piece
  const box = { id: 'box', name: 'Box Co', rows: [['سرنجة 5 مل', 20, 'خصم: 20', '', '']] };
  await openApp({ docs: seed({ suppliers: [nile, box] }) });
  await app.ready(page);
  await row(page, 'سرنجة 5 مل').first().locator('td.pname button').click();
  await page.locator('#pd-results').getByRole('button', { name: 'Same product' }).first().click();
  const dlg = page.locator('#dlg');
  // only the discount is known so far: 20 × 0.8 = 16 a "piece", so nile is still cheaper
  await expect(dlg.locator('tbody tr').nth(1)).toContainText('16.00');
  await dlg.locator('[data-pack^="box:"]').fill('10');
  await dlg.locator('[data-pack^="box:"]').press('Tab');
  await expect(dlg.locator('tbody tr').first()).toContainText('Box Co');
  await expect(dlg.locator('tbody tr').first()).toContainText('1.60');
  await expect(dlg).toContainText('Selling at 1.92');
  await expect.poll(async () => Object.values((await app.doc(page, 'matching/packs')).map)).toEqual([{ pack: 10 }]);
  await dlg.locator('[data-close]').click();
  const r = row(page, 'سرنجة 5 مل');
  await expect(r.locator('.chip.best')).toHaveText('Box Co 20.00 → 1.60');
  await expect(cost(page, 'سرنجة 5 مل')).toHaveText('1.60');
  await expect(r.locator('.det')).toHaveText('قطعة');
  // compared as listed, nile's 2.50 is cheapest again
  await app.tab(page, 'settings');
  await page.locator('#st-piece').selectOption('0');
  await app.tab(page, 'products');
  await expect(cost(page, 'سرنجة 5 مل')).toHaveText('2.50');
});

test('upload: pieces per pack, discount, a second price and sizes are guessed from the headers', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  await page.locator('#im-name').fill('شمس');
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'shams.xlsx', [
    ['الكود', 'اسم الصنف', 'English', 'السعر', 'تجاري', 'الوحدة', 'خصم', 'المقاس'],
    [101, 'رباط ضاغط', 'Bandage', 100, 120, 10, 25, '6 سم'],
    [102, 'شاش', 'Gauze', 50, 60, 1, '', '10 سم'],
  ]));
  const uses = await page.locator('[data-coluse]').evaluateAll(s => s.map(x => x.value));
  expect(uses.slice(0, 3)).toEqual(['skip', 'name', 'skip']);
  expect(uses.slice(3)).toEqual(['price', expect.stringMatching(/^f:/), 'pack', 'disc', 'detail']);
  await expect(page.locator('[data-collabel="7"]')).toHaveValue('المقاس');
  await expect(page.locator('[data-fieldname]')).toHaveValue('تجاري');
  // the new column is only saved when the list is imported
  await expect.poll(async () => (await app.doc(page, 'settings/main'))?.fields).toBeUndefined();
  await page.locator('#mp-go').click();
  await expect(page.locator('#sub')).toHaveText('2 products from 1 suppliers');
  await expect.poll(async () => Object.values((await app.doc(page, 'settings/main')).fields).map(f => f.name)).toEqual(['تجاري']);
  await expect(page.locator('#view thead')).toContainText('تجاري');
  await expect(cost(page, 'رباط ضاغط')).toHaveText('7.50'); // 100 less 25%, for 10 pieces
  await expect(row(page, 'رباط ضاغط').locator('.det')).toHaveText('المقاس: 6 سم · قطعة');
  await expect(cost(page, 'شاش')).toHaveText('50.00');
});

test('deleting a list also removes its links, pack sizes, dismissed pairs and product edits', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile, delta] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await page.locator('.match-row', { hasText: 'سرنجة' }).getByRole('button', { name: 'Same product' }).click();
  await page.locator('.match-row', { hasText: 'رباط' }).getByRole('button', { name: 'Different' }).click();
  await app.tab(page, 'products');
  const mask = row(page, 'كمامة');
  await mask.locator('input.margin').fill('50');
  await mask.locator('input.margin').press('Tab');
  await mask.locator('td.pname button').click();
  await page.locator('[data-pack]').fill('50');
  await page.locator('[data-pack]').press('Tab');
  await page.locator('#dlg [data-close]').click();
  // nile's own edit stays
  const gown = row(page, 'جاون عزل');
  await gown.locator('input.margin').fill('30');
  await gown.locator('input.margin').press('Tab');
  await expect.poll(async () => Object.keys(await app.store(page)).filter(k => k.startsWith('products/')).length).toBe(2);
  await app.tab(page, 'suppliers');
  const del = page.locator('[data-del-sup="delta"]');
  await del.click();
  await del.click();
  await expect(page.locator('#sub')).toHaveText('6 products from 1 suppliers');
  await expect.poll(async () => {
    const st = await app.store(page);
    return [Object.keys(st['matching/links'].map), Object.keys(st['matching/packs'].map), Object.keys(st['matching/dismissed'].map), Object.keys(st).filter(k => k.startsWith('products/')).length];
  }).toEqual([[], [], [], 1]);
});

test('a PDF row whose price can\'t be read is kept and flagged, and can be removed with one click', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  const p = info.outputPath('list.pdf');
  require('fs').writeFileSync(p, priceListPdf([['Gauze roll 10 cm', '25.00'], ['Syringe 5 ml', '2.50'], ['Mask 3 ply', '-'], ['Cotton 100 g', '30']]));
  await page.locator('#im-name').fill('PDF Supplier');
  await page.setInputFiles('#im-file', p);
  await expect(page.locator('#im-map')).toContainText('4 rows found');
  await expect(page.locator('#im-map')).toContainText('1 rows need a price');
  await expect(page.locator('#mp-go')).toBeDisabled();
  await page.locator('#mp-dropbad').click();
  await expect(page.locator('#mp-go')).toHaveText('Import 3 items');
  await expect(page.locator('#mp-go')).toBeEnabled();
});

test('the PDF and OCR readers are only downloaded when a PDF is uploaded', async ({ page, openApp }, info) => {
  const asked = [];
  page.on('request', r => asked.push(r.url()));
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  expect(asked.filter(u => /pdf\.min\.js|tesseract/.test(u))).toEqual([]);
  await app.tab(page, 'suppliers');
  const p = info.outputPath('a.pdf');
  require('fs').writeFileSync(p, priceListPdf([['Gauze roll', '25'], ['Syringe', '2']]));
  await page.setInputFiles('#im-file', p);
  await expect(page.locator('#im-map')).toContainText('Finished reading a.pdf');
  expect(asked.filter(u => /pdf\.min\.js|tesseract/.test(u))).toHaveLength(2);
});

test('the list date starts as today and is saved with the list', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await expect(page.locator('#im-date')).toHaveValue(today);
  await page.locator('#im-name').fill('Dated');
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'd.xlsx', [['Item', 'Price'], ['Gauze', 5]]));
  await page.locator('#mp-go').click();
  await expect(page.locator('#sub')).toHaveText('1 products from 1 suppliers');
  await app.tab(page, 'suppliers');
  await expect(page.locator('.panel.supplier')).toContainText('list date ' + today);
});

test('delete buttons go back to normal if the second click doesn\'t come', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile], quotes: { 'q-1': { customer: 'C', date: '2026-10-01', notes: '', lines: [], updated: '2026-10-01' } } }) });
  await app.ready(page);
  await app.tab(page, 'quote');
  await page.clock.install();
  const del = page.locator('[data-delq="q-1"]');
  await del.click();
  await expect(del).toHaveText('Click again');
  await page.clock.runFor(4100);
  await expect(del).toHaveText('Delete');
  await expect(del).not.toHaveClass(/armed/);
});

test('a margin of 100% or more is refused when the margin is taken from the sale price', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile], settings: { mode: 'margin' } }) });
  await app.ready(page);
  const r = row(page, 'سرنجة 5 مل');
  await r.locator('input.margin').fill('100');
  await r.locator('input.margin').press('Tab');
  await expect(app.toast(page)).toContainText('a margin must be under 100%');
  await expect(r.locator('input.margin')).toHaveValue('');
  await app.tab(page, 'settings');
  await page.locator('#st-m').fill('150');
  await page.locator('#st-m').press('Tab');
  await expect(page.locator('#st-m')).toHaveValue('20');
  // switching modes is refused while a margin is 100% or more
  await page.locator('#st-mode').selectOption('markup');
  await page.locator('#st-m').fill('150');
  await page.locator('#st-m').press('Tab');
  await page.locator('#st-mode').selectOption('margin');
  await expect(app.toast(page)).toContainText('Some margins are 100% or more');
  await expect(page.locator('#st-mode')).toHaveValue('markup');
});
