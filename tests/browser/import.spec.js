// Adding and updating supplier lists: Excel, CSV (UTF-8 and Windows-1256), PDF and photos,
// choosing columns, the price-change report on re-upload, and deleting a list.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');
const { priceListPdf } = require('../support/make-pdf');
const { toWindows1256 } = require('../support/encode');

const colSelect = (page, i) => page.locator(`[data-coluse="${i}"]`);
const importBtn = page => page.locator('#mp-go');
const supplierCard = (page, name) => page.locator('.panel.supplier', { has: page.locator('.name', { hasText: name }) });
async function openSuppliers(page) { await app.ready(page); await app.tab(page, 'suppliers'); }

test('Excel with Arabic headers: columns are guessed, rows without a price are skipped, and the list is saved', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await expect(page.locator('#view h2')).toHaveText('No price lists yet');
  await app.tab(page, 'suppliers');
  const file = app.xlsxFile(info, 'list.xlsx', [
    ['م', 'اسم الصنف', 'العبوة', 'السعر'],
    [1, 'شاش طبي 10 سم', 'علبة', '25 ج.م'],
    [2, 'سرنجة 5 مل', 'قطعة', 2.5],
    [3, 'قطن طبي 100 جرام', 'لفة', '1,250'],
    [4, 'بدون سعر', 'قطعة', ''],
    [5, 'سعر صفر', 'قطعة', 0],
    ['', '', '', ''],
  ]);
  await page.setInputFiles('#im-file', file);
  await expect(colSelect(page, 1)).toHaveValue('name');
  await expect(colSelect(page, 3)).toHaveValue('price');
  await expect(colSelect(page, 0)).toHaveValue('skip');
  await expect(importBtn(page)).toHaveText('Import 3 items');
  // no supplier name yet
  await importBtn(page).click();
  await expect(app.toast(page)).toHaveText('Give the supplier a name first.');
  await page.locator('#im-name').fill('مورد التجربة');
  await page.locator('#im-date').fill('2026-10-15');
  // pack column as a detail with its own label
  await colSelect(page, 2).selectOption('detail');
  await page.locator('[data-collabel="2"]').fill('العبوة');
  await page.locator('[data-collabel="2"]').press('Tab');
  await expect(page.locator('#im-map tbody').nth(1)).toContainText('العبوة: علبة');
  await importBtn(page).click();
  await expect(app.toast(page)).toHaveText('Imported 3 items from مورد التجربة');
  await expect(page.locator('#sub')).toHaveText('3 products from 1 suppliers');
  // only one supplier, so nothing to match: it opens Products
  await expect(page.locator('#tabs [aria-selected="true"]')).toHaveText('Products');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody')).toContainText('1,250.00');

  const store = await app.store(page);
  const supId = Object.keys(store).find(k => k.startsWith('suppliers/')).slice(10);
  expect(store['suppliers/' + supId]).toMatchObject({ name: 'مورد التجربة', file: 'list.xlsx', date: '2026-10-15', chunks: 1, count: 3, header: true });
  expect(store['suppliers/' + supId].columns.map(c => [c.header, c.use, c.label])).toEqual([
    ['م', 'skip', ''], ['اسم الصنف', 'name', ''], ['العبوة', 'detail', 'العبوة'], ['السعر', 'price', ''],
  ]);
  expect(store[`items/${supId}-0`].rows[0]).toEqual({ n: 'شاش طبي 10 سم', p: 25, d: 'العبوة: علبة', s: 'row 2', c: '' });
});

test('a file whose first row is already an item does not lose it', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  await page.locator('#im-name').fill('بدون عناوين');
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'noheader.xlsx', [
    ['شاش طبي 10 سم', 25], ['سرنجة 5 مل', 2.5], ['قطن طبي', 30],
  ]));
  await expect(page.locator('#mp-head')).not.toBeChecked();
  await expect(importBtn(page)).toHaveText('Import 3 items');
  // and ticking the box drops the first row
  await page.locator('#mp-head').check();
  await expect(importBtn(page)).toHaveText('Import 2 items');
});

test('choosing columns: one name and one price at a time, unit, and a new column of your own', async ({ page, openApp }, info) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await openSuppliers(page);
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'cols.xlsx', [
    ['Item', 'Unit', 'Trade', 'Public', 'Size'],
    ['Gauze roll', 'roll', 10, 12, '10 cm'],
    ['Syringe', 'piece', 2, 3, '5 ml'],
  ]));
  await page.locator('#im-name').fill('Cairo Med');
  await expect(colSelect(page, 0)).toHaveValue('name');
  await expect(colSelect(page, 2)).toHaveValue('price'); // first price-like column with the most numbers
  // picking Price for another column takes it away from the first
  await colSelect(page, 3).selectOption('price');
  await expect(colSelect(page, 2)).toHaveValue('skip');
  await colSelect(page, 1).selectOption('unit');
  await colSelect(page, 4).selectOption('detail');
  page.once('dialog', d => d.accept('تجاري'));
  await colSelect(page, 2).selectOption('+new');
  await expect(colSelect(page, 2)).toHaveValue(/^f:/);
  await expect(page.locator('[data-fieldname]')).toHaveValue('تجاري');
  // cancelling the name prompt changes nothing
  page.once('dialog', d => d.dismiss());
  await colSelect(page, 4).selectOption('+new');
  await expect(colSelect(page, 4)).toHaveValue('detail');
  // without a name column nothing can be imported
  await colSelect(page, 0).selectOption('skip');
  await expect(page.locator('#im-map')).toContainText('Choose which column has the item name.');
  await expect(importBtn(page)).toBeDisabled();
  await colSelect(page, 0).selectOption('name');
  await importBtn(page).click();
  await expect(app.toast(page)).toHaveText('Imported 2 items from Cairo Med');

  await expect.poll(async () => Object.keys((await app.doc(page, 'settings/main'))?.fields || {}).length).toBe(1);
  const fields = (await app.doc(page, 'settings/main')).fields;
  const fid = Object.keys(fields)[0];
  expect(fields[fid].name).toBe('تجاري');
  await app.tab(page, 'products');
  await expect(page.locator('thead')).toContainText('تجاري');
  const row = page.locator('tbody tr', { hasText: 'Gauze roll' });
  await expect(row).toContainText('10 cm · roll');
  await expect(row.locator('td').nth(1)).toHaveText('10');
  await expect(row).toContainText('12.00');
});

test('CSV files keep Arabic whether saved as UTF-8 or as Windows-1256', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  const csv = 'الصنف,السعر\nشاش طبي,25\nسرنجة,"2,5"\n';
  await page.locator('#im-name').fill('UTF8 supplier');
  await page.setInputFiles('#im-file', app.textFile(info, 'utf8.csv', '\uFEFF' + csv));
  await expect(page.locator('#im-map tbody').nth(1)).toContainText('شاش طبي');
  await expect(colSelect(page, 0)).toHaveValue('name');
  await expect(page.locator('#im-map tbody').nth(1)).toContainText('2.50');
  await page.locator('#mp-cancel').click();
  await expect(page.locator('#im-map')).toBeEmpty();

  const p = info.outputPath('win.csv');
  require('fs').writeFileSync(p, toWindows1256(csv));
  await page.setInputFiles('#im-file', p);
  await expect(page.locator('#im-map tbody').nth(1)).toContainText('شاش طبي');
  await expect(page.locator('#im-map thead').first()).toBeVisible();
  await expect(page.locator('#im-map tbody').first()).toContainText('الصنف');
});

test('a file that is not a spreadsheet shows a message', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  await page.setInputFiles('#im-file', app.textFile(info, 'empty.csv', ''));
  await expect(app.toast(page)).toHaveText('That file has no rows.');
});

test('re-uploading a supplier: saved columns are reused and the price changes are reported', async ({ page, openApp }, info) => {
  // nile's first item is linked with delta's, so dropping it loses a match
  const docs = seed({
    suppliers: [{ ...nile, header: true, columns: [{ header: 'الصنف', use: 'name', label: '', col: 0 }, { header: 'السعر', use: 'price', label: '', col: 1 }] }, delta],
  });
  await openApp({ docs });
  await openSuppliers(page);
  // link the gauze pair first, from the Matching tab
  await app.tab(page, 'matching');
  await page.locator('.match-row', { hasText: 'شاش طبي 10' }).getByRole('button', { name: 'Same product' }).click();
  await app.tab(page, 'suppliers');
  await supplierCard(page, 'النيل الطبية').getByRole('button', { name: 'Upload new prices' }).click();
  await expect(page.locator('#import h2')).toHaveText('Upload new prices for النيل الطبية');
  await expect(page.locator('#im-name')).toBeDisabled();
  // columns moved around in the new file; the saved choices follow the headers
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'nile-new.xlsx', [
    ['ملاحظة', 'السعر', 'الصنف'],
    ['', 20, 'شاش طبي 7.5 سم'], // up from 18
    ['', 12, 'رباط ضاغط 10 سم'], // down from 15
    ['', 2.5, 'سرنجة 5 مل'], // same
    ['', 120, 'قفاز جراحي مقاس 7'], // detail was "علبة: 50", now none: counts as new + removed
    ['', 40, 'جاون عزل XL'],
    ['', 9, 'بلاستر جديد'], // new
  ]));
  await expect(page.locator('#im-map')).toContainText('These are the choices from the last upload of this supplier.');
  await expect(colSelect(page, 2)).toHaveValue('name');
  await expect(colSelect(page, 1)).toHaveValue('price');
  const report = page.locator('#im-map .panel');
  await expect(report).toContainText('1 went up · 1 went down · 1 unchanged · 3 new · 3 no longer listed');
  await expect(report).toContainText('1 item no longer listed was matched with another supplier');
  await importBtn(page).click();
  await expect(app.toast(page)).toHaveText('Imported 6 items from النيل الطبية');
  await app.tab(page, 'suppliers');
  await expect(supplierCard(page, 'النيل الطبية')).toContainText('1 up, 1 down, 3 new, 3 no longer listed');
  await app.tab(page, 'products');
  await page.locator('#filter').selectOption('changed');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr', { hasText: 'شاش طبي 7.5' })).toContainText('▲11%');
  await expect(page.locator('tbody tr', { hasText: 'رباط ضاغط 10' })).toContainText('▼20%');
});

test('large lists are saved in parts of 500 rows, and a shorter re-upload removes the extra part', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  const rows = [['Item', 'Price'], ...Array.from({ length: 1201 }, (_, i) => ['Item number ' + i, i + 1])];
  await page.locator('#im-name').fill('Big');
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'big.xlsx', rows));
  await importBtn(page).click();
  await expect(page.locator('#sub')).toHaveText('1,201 products from 1 suppliers');
  let store = await app.store(page);
  expect(Object.keys(store).filter(k => k.startsWith('items/')).length).toBe(3);
  await expect(page.locator('.pager .muted')).toHaveText('1,201 shown · page 1 of 13');
  await app.tab(page, 'suppliers');
  await page.getByRole('button', { name: 'Upload new prices' }).click();
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'small.xlsx', rows.slice(0, 11)));
  await importBtn(page).click();
  await expect(page.locator('#sub')).toHaveText('10 products from 1 suppliers');
  store = await app.store(page);
  expect(Object.keys(store).filter(k => k.startsWith('items/'))).toHaveLength(1);
});

test('deleting a list needs a second click and removes its items', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile, delta] }) });
  await openSuppliers(page);
  const del = supplierCard(page, 'الدلتا للمستلزمات').locator('[data-del-sup]');
  await del.click();
  await expect(del).toHaveText('Click again to delete');
  await expect.poll(async () => Object.keys(await app.store(page))).toContain('suppliers/delta');
  await del.click();
  await expect(app.toast(page)).toHaveText("Deleted الدلتا للمستلزمات's list");
  await expect(page.locator('#sub')).toHaveText('6 products from 1 suppliers');
  await expect.poll(async () => Object.keys(await app.store(page)).filter(k => k.includes('delta'))).toEqual([]);
});

test('PDF with a text layer: rows are read, can be fixed or removed, then imported', async ({ page, openApp }, info) => {
  await openApp({ docs: {} });
  await app.tab(page, 'suppliers');
  const p = info.outputPath('list.pdf');
  require('fs').writeFileSync(p, priceListPdf([['Gauze roll 10 cm', '25.00'], ['Syringe 5 ml', '2.50'], ['Cotton 100 g', '30'], ['Mask 3 ply', '1.75']]));
  await page.locator('#im-name').fill('PDF Supplier');
  await page.setInputFiles('#im-file', p);
  await expect(page.locator('#im-map')).toContainText('Finished reading list.pdf');
  await expect(page.locator('#im-map')).toContainText('1 of 1 pages · 4 rows found');
  // a price cleared by hand has to be filled in before importing
  await page.locator('[data-vrow="3"][data-vf="price"]').fill('');
  await page.locator('[data-vrow="3"][data-vf="price"]').press('Tab');
  await expect(page.locator('#im-map')).toContainText('1 rows need a price');
  await expect(importBtn(page)).toBeDisabled();
  await page.locator('[data-vrow="3"][data-vf="price"]').fill('1.5');
  await page.locator('[data-vrow="3"][data-vf="price"]').press('Tab');
  await expect(importBtn(page)).toHaveText('Import 4 items');
  await page.locator('[data-vdel="2"]').click();
  await expect(page.locator('[data-vdel]')).toHaveCount(3);
  await page.locator('[data-vrow="0"][data-vf="name"]').fill('Gauze roll 10 cm sterile');
  await page.locator('[data-vrow="0"][data-vf="name"]').press('Tab');
  await expect(importBtn(page)).toHaveText('Import 3 items');
  await expect(page.locator('#mp-ocr')).toBeVisible();
  await importBtn(page).click();
  await expect(app.toast(page)).toHaveText('Imported 3 items from PDF Supplier');
  await expect(page.locator('tbody')).toContainText('Gauze roll 10 cm sterile');
  await expect(page.locator('tbody')).not.toContainText('Cotton');
  const store = await app.store(page);
  const items = Object.entries(store).find(([k]) => k.startsWith('items/'))[1];
  expect(items.rows.map(r => [r.n, r.p, r.s])).toEqual([['Gauze roll 10 cm sterile', 25, 'p1'], ['Syringe 5 ml', 2.5, 'p1'], ['Mask 3 ply', 1.5, 'p1']]);
});

test('photo of a price list is read on the device (OCR) and imported', async ({ page, openApp }, info) => {
  await openApp({ docs: {}, ocrRows: [['شاش طبي 10 سم', '25'], ['سرنجة 5 مل', '2.5'], ['قطن طبي', '30']] });
  await app.tab(page, 'suppliers');
  // a 1x1 PNG; the stand-in OCR returns the rows set above
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const p = info.outputPath('photo.png'); require('fs').writeFileSync(p, png);
  await page.locator('#im-name').fill('Photo Supplier');
  await page.setInputFiles('#im-file', p);
  await expect(page.locator('#im-map')).toContainText('Finished reading photo.png');
  await expect(page.locator('#im-map .chip').first()).toContainText('Page 1: 3 rows · scanned');
  await expect(page.locator('#mp-ocr')).toHaveCount(0);
  await expect(page.locator('[data-vrow="1"][data-vf="price"]')).toHaveValue('2.5');
  await importBtn(page).click();
  await expect(page.locator('#sub')).toHaveText('3 products from 1 suppliers');
});

test('cancel clears a half-done upload', async ({ page, openApp }, info) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await openSuppliers(page);
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'x.xlsx', [['Item', 'Price'], ['A thing', 1]]));
  await expect(importBtn(page)).toBeVisible();
  await page.locator('#mp-cancel').click();
  await expect(importBtn(page)).toHaveCount(0);
  await expect(page.locator('#import h2')).toHaveText('Add a supplier price list');
});
