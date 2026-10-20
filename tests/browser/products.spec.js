// The Products tab and product page: search, filters, sorting, pages, margins, choosing a supplier,
// editing product details, linking and separating items, and the two Excel downloads.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');

const row = (page, text) => page.locator('#view tbody tr', { hasText: text });
const names = page => page.locator('#view tbody td.pname button').allTextContents();
async function start(openApp, page, extra = {}) {
  await openApp({ docs: seed({ suppliers: [nile, delta], ...extra }) });
  await app.ready(page);
}
// link two items from the product page of the first: search, then "Same product"
async function link(page, from, search, pick) {
  await row(page, from).locator('td.pname button').click();
  await page.locator('#pd-search').fill(search);
  await page.locator('#pd-results tr', { hasText: pick }).getByRole('button', { name: 'Same product' }).click();
  await expect(page.locator('#dlg')).toContainText('best');
  await page.locator('#dlg [data-close]').click();
}

test('search finds words in any order and ignores Arabic spelling differences', async ({ page, openApp }) => {
  await start(openApp, page);
  await page.locator('#q').fill('طبى شاش');
  await expect(page.locator('.pager .muted')).toHaveText('3 shown · page 1 of 1');
  await page.locator('#q').fill('السرنجة');
  await expect(page.locator('.pager .muted')).toHaveText('2 shown · page 1 of 1');
  await page.locator('#q').fill('١٠ رباط');
  await expect(page.locator('.pager .muted')).toHaveText('2 shown · page 1 of 1');
  await page.locator('#q').fill('لا يوجد');
  await expect(page.locator('#view tbody')).toContainText('No products match');
  // the search box keeps focus while the list redraws
  await expect(page.locator('#q')).toBeFocused();
});

test('filters by supplier, by category and by "sold by 2+ suppliers"', async ({ page, openApp }) => {
  await start(openApp, page);
  await page.locator('#filter').selectOption('sup:delta');
  await expect(page.locator('#view tbody tr')).toHaveCount(5);
  await page.locator('#filter').selectOption('all');
  await page.locator('#cat').selectOption('شاش');
  await expect(page.locator('#view tbody tr')).toHaveCount(2);
  await page.locator('#cat').selectOption('');
  await page.locator('#filter').selectOption('multi');
  await expect(page.locator('#view tbody')).toContainText('No products match');
  await page.locator('#filter').selectOption('all');
  await link(page, 'سرنجة 5 مل', 'سرنجه', 'سرنجه 5مل');
  await page.locator('#filter').selectOption('multi');
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await expect(page.locator('.stat').nth(1)).toContainText('1');
});

test('sorting by name, price, number of suppliers and saving', async ({ page, openApp }) => {
  await start(openApp, page);
  await page.locator('#sort').selectOption('best');
  expect((await names(page))[0]).toBe('كمامة طبية 3 طبقات');
  await page.locator('#sort').selectOption('bestd');
  expect((await names(page))[0]).toBe('قفازات فحص لاتكس M');
  await link(page, 'رباط ضاغط 10 سم', 'رباط', 'رباط ضاغط ١٠ سم');
  await page.locator('#sort').selectOption('offers');
  expect((await names(page))[0]).toBe('رباط ضاغط 10 سم');
  await page.locator('#sort').selectOption('saving');
  expect((await names(page))[0]).toBe('رباط ضاغط 10 سم');
  await page.locator('#sort').selectOption('name');
  const sorted = await names(page);
  expect(sorted).toEqual([...sorted].sort((a, b) => a.localeCompare(b, 'ar')));
});

test('pages of 100 with Next and Previous', async ({ page, openApp }) => {
  const many = { id: 'many', name: 'Many', rows: Array.from({ length: 150 }, (_, i) => [`Item ${String(i).padStart(3, '0')}`, i + 1]) };
  await openApp({ docs: seed({ suppliers: [many] }) });
  await app.ready(page);
  await expect(page.locator('#view tbody tr')).toHaveCount(100);
  await expect(page.locator('#prev')).toBeDisabled();
  await page.locator('#next').click();
  await expect(page.locator('#view tbody tr')).toHaveCount(50);
  await expect(page.locator('.pager .muted')).toHaveText('150 shown · page 2 of 2');
  await expect(page.locator('#next')).toBeDisabled();
  await page.locator('#prev').click();
  await expect(page.locator('.pager .muted')).toHaveText('150 shown · page 1 of 2');
  // a new search goes back to page 1
  await page.locator('#next').click();
  await page.locator('#q').fill('Item 014');
  await expect(page.locator('.pager .muted')).toHaveText('1 shown · page 1 of 1'); // numbers match whole, so 140 doesn't count
});

test('a product margin overrides the default and can be cleared', async ({ page, openApp }) => {
  await start(openApp, page);
  const r = row(page, 'سرنجة 5 مل');
  await expect(r.locator('td.sell')).toHaveText('3.00'); // 2.50 + 20%
  await r.locator('input.margin').fill('50');
  await r.locator('input.margin').press('Tab');
  await expect(r.locator('td.sell')).toHaveText('3.75');
  await expect(r.locator('td.num').last()).toHaveText('1.25');
  const pid = await r.locator('input.margin').getAttribute('data-pid');
  await expect.poll(async () => await app.doc(page, 'products/' + pid)).toEqual({ margin: 0.5 });
  await r.locator('input.margin').fill('');
  await r.locator('input.margin').press('Tab');
  await expect(r.locator('td.sell')).toHaveText('3.00');
  await expect.poll(async () => await app.doc(page, 'products/' + pid)).toEqual({});
});

test('buy from: the cheapest supplier by default, or the one you choose', async ({ page, openApp }) => {
  await start(openApp, page);
  await link(page, 'شاش طبي 10 سم', 'شاش طبى', 'شاش طبى ١٠سم');
  const r = row(page, 'شاش طبي 10 سم × 10 سم');
  await expect(r.locator('select.buy option').first()).toHaveText('Cheapest (الدلتا للمستلزمات)');
  await expect(r.locator('td.num').first()).toHaveText('22.00');
  await expect(r.locator('.chip.best')).toHaveText('الدلتا للمستلزمات 22.00');
  await r.locator('select.buy').selectOption('nile');
  await expect(r.locator('td.num').first()).toHaveText('25.00');
  await expect(r.locator('td.sell')).toHaveText('30.00');
  await r.locator('select.buy').selectOption('');
  await expect(r.locator('td.num').first()).toHaveText('22.00');
});

test('product page: edit the name, details, category and unit, and go back to the supplier text', async ({ page, openApp }) => {
  await start(openApp, page);
  await row(page, 'سرنجة 5 مل').locator('td.pname button').click();
  const dlg = page.locator('#dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#pd-name')).toHaveAttribute('placeholder', 'سرنجة 5 مل');
  await dlg.locator('#pd-name').fill('سرنجة بلاستيك 5 مل');
  await dlg.locator('#pd-detail').fill('معقمة');
  await dlg.locator('#pd-cat').fill('سرنجات');
  await dlg.locator('#pd-unit').fill('علبة 100');
  await dlg.locator('#pd-save').click();
  await expect(dlg).toBeHidden();
  await expect(app.toast(page)).toHaveText('Product details saved');
  const r = row(page, 'سرنجة بلاستيك 5 مل');
  await expect(r.locator('.det')).toHaveText('معقمة · علبة 100');
  await expect(r.locator('.chip.cat')).toHaveText('سرنجات');
  await expect(page.locator('#cat option')).toContainText(['All categories', 'سرنجات', 'شاش', 'ملابس']);
  // empty fields go back to the supplier's text
  await r.locator('td.pname button').click();
  for (const id of ['#pd-name', '#pd-detail', '#pd-cat', '#pd-unit']) await dlg.locator(id).fill('');
  await dlg.locator('#pd-save').click();
  await expect(row(page, 'سرنجة 5 مل').first()).toBeVisible();
  await expect(page.locator('#view tbody')).not.toContainText('سرنجة بلاستيك');
});

test('product page: link the same item from another supplier, then separate it again', async ({ page, openApp }) => {
  await start(openApp, page);
  await row(page, 'رباط ضاغط 10 سم').locator('td.pname button').click();
  const dlg = page.locator('#dlg');
  // suggestions are shown before searching
  await expect(dlg.locator('#pd-results')).toContainText('رباط ضاغط ١٠ سم');
  await expect(dlg.locator('#pd-results .chip')).toHaveText('Very likely');
  // a search only lists items from other suppliers
  await dlg.locator('#pd-search').fill('شاش');
  await expect(dlg.locator('#pd-results tr')).toHaveCount(1);
  await expect(dlg.locator('#pd-results')).toContainText('الدلتا للمستلزمات');
  await dlg.locator('#pd-search').fill('رباط');
  await dlg.locator('#pd-results').getByRole('button', { name: 'Same product' }).click();
  await expect(app.toast(page)).toHaveText('Linked. Prices are now compared side by side.');
  await expect(dlg.locator('table').first()).toContainText('النيل الطبية');
  await expect(dlg.locator('table').first()).toContainText('الدلتا للمستلزمات');
  await expect(dlg).toContainText('Selling at 18.00 ج.م with a 20% markup on a cost of 15.00 from النيل الطبية.');
  await expect.poll(async () => Object.keys((await app.doc(page, 'matching/links')).map)).toHaveLength(1);
  await expect(page.locator('#sub')).toHaveText('10 products from 2 suppliers');
  await dlg.locator('[data-split]').first().click();
  await expect(dlg).toBeHidden();
  await expect(app.toast(page)).toHaveText('Separated into its own product');
  await expect(page.locator('#sub')).toHaveText('11 products from 2 suppliers');
});

test('add to quote from the Products tab', async ({ page, openApp }) => {
  await start(openApp, page);
  const btn = row(page, 'سرنجة 5 مل').locator('[data-addq]');
  await btn.click();
  await expect(btn).toHaveText('In quote');
  await expect(btn).toBeDisabled();
  await expect(page.locator('#cnt-quote')).toHaveText('1');
});

test('customer price list download: company name, currency, sell prices, only what is shown', async ({ page, openApp }) => {
  await start(openApp, page, { settings: { company: 'Omega Medical', currency: 'EGP', defaultMargin: 0.1 } });
  await page.locator('#filter').selectOption('sup:nile');
  const x = await app.download(page, () => page.locator('#exp-cust').click());
  expect(x.name).toMatch(/^Price list \d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(x.rows[0]).toEqual(['Omega Medical', '', '', '', '', '']);
  expect(x.rows[1][0]).toBe('قائمة الأسعار / Price list');
  expect(x.rows[3]).toEqual(['#', 'اسم المنتج / Product', 'التفاصيل / Details', 'الفئة / Category', 'الوحدة / Unit', 'السعر / Price (EGP)']);
  const body = x.rows.slice(4);
  expect(body).toHaveLength(6);
  expect(body.find(r => r[1] === 'سرنجة 5 مل')[5]).toBe(2.75);
  // grouped by category: no category first, then شاش, then ملابس
  expect(body.map(r => r[3])).toEqual(['', '', '', 'شاش', 'شاش', 'ملابس']);
  expect(x.wb.Workbook.Views[0].RTL).toBe(true);
});

test('full costing sheet download: suppliers, best price, buying from, margin and profit', async ({ page, openApp }) => {
  await start(openApp, page);
  await link(page, 'شاش طبي 10 سم', 'شاش طبى', 'شاش طبى ١٠سم');
  const x = await app.download(page, () => page.locator('#exp-int').click());
  expect(x.name).toMatch(/^Costing sheet /);
  expect(x.rows[0]).toEqual(['Product', 'Details', 'Category', 'Unit', 'Suppliers (cheapest first)', 'Best price', 'Best supplier', 'Buying from', 'Listed price', 'Discount %', 'Pieces per pack', 'Cost', 'Margin %', 'Sell price', 'Profit']);
  const gauze = x.rows.find(r => r[0] === 'شاش طبي 10 سم × 10 سم');
  expect(gauze).toEqual(['شاش طبي 10 سم × 10 سم', '', 'شاش', '', 'الدلتا للمستلزمات: 22 | النيل الطبية: 25', 22, 'الدلتا للمستلزمات', 'الدلتا للمستلزمات', 22, 0, 1, 22, 20, 26.4, 4.4]);
  expect(x.rows).toHaveLength(11);
});
