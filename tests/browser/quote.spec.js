// The Customer quote tab: adding products, quantities, hand-typed prices, totals, saving and
// reopening quotes, prices that moved since saving, the draft kept on this device, and the Excel file.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');

const line = (page, text) => page.locator('#view tbody tr', { hasText: text });
const totalRow = page => page.locator('tr.qtotal');
async function start(openApp, page, extra = {}) {
  await openApp({ docs: seed({ suppliers: [nile, delta], ...extra }) });
  await app.ready(page);
  await app.tab(page, 'quote');
}
async function add(page, search, pick) {
  await page.locator('#qt-add').fill(search);
  await page.locator('#qt-results tr', { hasText: pick }).getByRole('button', { name: 'Add' }).click();
}

test('build a quote: search, add, quantities, a hand-typed price, totals and profit', async ({ page, openApp }) => {
  await start(openApp, page);
  await expect(page.locator('#qt-xlsx')).toBeDisabled();
  await page.locator('#qt-add').fill('ش');
  await expect(page.locator('#qt-results')).toBeHidden();
  await page.locator('#qt-add').fill('زيت');
  await expect(page.locator('#qt-results')).toContainText('No products found');
  await add(page, 'سرنجة', 'سرنجة 5 مل');
  await add(page, 'شاش ١٠', 'شاش طبي 10 سم × 10 سم');
  await expect(page.locator('#cnt-quote')).toHaveText('2');
  // adding the same product twice does nothing
  await add(page, 'سرنجة', 'سرنجة 5 مل');
  await expect(page.locator('#cnt-quote')).toHaveText('2');
  await line(page, 'سرنجة').locator('[data-qty]').fill('10');
  await line(page, 'سرنجة').locator('[data-qty]').press('Tab');
  await expect(line(page, 'سرنجة').locator('td.sell')).toHaveText('30.00'); // 10 × 3.00
  await line(page, 'شاش').locator('[data-uprice]').fill('35');
  await line(page, 'شاش').locator('[data-uprice]').press('Tab');
  await expect(totalRow(page)).toContainText('65.00'); // 30 + 35
  await expect(totalRow(page)).toContainText('50.00'); // cost 25 + 25
  await expect(totalRow(page)).toContainText('profit 15.00');
  // a negative quantity becomes 0
  await line(page, 'سرنجة').locator('[data-qty]').fill('-3');
  await line(page, 'سرنجة').locator('[data-qty]').press('Tab');
  await expect(line(page, 'سرنجة').locator('[data-qty]')).toHaveValue('0');
  await line(page, 'سرنجة').locator('[data-rmq]').click();
  await expect(page.locator('#cnt-quote')).toHaveText('1');
});

test('saving: needs a product, then keeps the prices and shows in Saved quotes', async ({ page, openApp }) => {
  await start(openApp, page);
  await page.locator('#qt-save').click();
  await expect(app.toast(page)).toHaveText('Add at least one product first.');
  await page.locator('#qt-cust').fill('عيادة النور');
  await page.locator('#qt-date').fill('2026-10-20');
  await page.locator('#qt-notes').fill('الأسعار سارية 7 أيام');
  await add(page, 'سرنجة', 'سرنجة 5 مل');
  await page.locator('#qt-save').click();
  await expect(app.toast(page)).toHaveText('Quote saved');
  await expect(page.locator('#view h2')).toHaveText('Quote for عيادة النور');
  const store = await app.store(page);
  const [id, q] = Object.entries(store).find(([k]) => k.startsWith('quotes/'));
  expect(q).toMatchObject({ customer: 'عيادة النور', date: '2026-10-20', notes: 'الأسعار سارية 7 أيام', lines: [{ qty: 1, price: 3, manual: false, name: 'سرنجة 5 مل' }] });
  await expect(page.locator('#view .panel h3')).toHaveText('Saved quotes');
  await expect(page.locator('#view .panel').last()).toContainText('عيادة النور');
  // start a new one, then open the saved one again
  await page.locator('#qt-new').click();
  await expect(page.locator('#view h2')).toHaveText('New customer quote');
  await expect(page.locator('#cnt-quote')).toHaveText('0');
  await page.locator(`[data-loadq="${id.slice(7)}"]`).click();
  await expect(page.locator('#qt-cust')).toHaveValue('عيادة النور');
  await expect(page.locator('#qt-notes')).toHaveValue('الأسعار سارية 7 أيام');
  await expect(page.locator('[data-uprice]')).toHaveValue('3');
});

test('a saved quote keeps its prices when the price list moves, until you choose today\'s prices', async ({ page, openApp }) => {
  await start(openApp, page);
  await add(page, 'سرنجة', 'سرنجة 5 مل');
  await add(page, 'رباط ضاغط 10', 'رباط ضاغط 10 سم');
  await line(page, 'رباط').locator('[data-uprice]').fill('50');
  await line(page, 'رباط').locator('[data-uprice]').press('Tab');
  await page.locator('#qt-save').click();
  // the default margin goes from 20% to 40%
  await page.evaluate(() => window.__fake.remoteSet('settings/main', { defaultMargin: 0.4 }, true));
  await expect(page.locator('#view .note')).toContainText('Some prices have changed since this quote was saved.');
  await expect(line(page, 'سرنجة')).toContainText('today 3.50');
  await expect(line(page, 'سرنجة').locator('[data-uprice]')).toHaveValue('3');
  await page.locator('#qt-today').click();
  await expect(line(page, 'سرنجة').locator('[data-uprice]')).toHaveValue('');
  await expect(line(page, 'سرنجة').locator('td.sell')).toHaveText('3.50');
  // the hand-typed price stays
  await expect(line(page, 'رباط').locator('[data-uprice]')).toHaveValue('50');
  await expect(page.locator('#view .note')).toHaveCount(0);
});

test('the quote being written survives a reload on this device', async ({ page, openApp }) => {
  await start(openApp, page);
  await page.locator('#qt-cust').fill('صيدلية');
  await add(page, 'سرنجة', 'سرنجة 5 مل');
  await page.reload();
  await app.ready(page);
  await expect(page.locator('#cnt-quote')).toHaveText('1');
  await app.tab(page, 'quote');
  await expect(page.locator('#qt-cust')).toHaveValue('صيدلية');
});

test('a product whose list was deleted is flagged but the quote still works', async ({ page, openApp }) => {
  await start(openApp, page);
  await add(page, 'كمامة', 'كمامة طبية 3 طبقات');
  await line(page, 'كمامة').locator('[data-uprice]').fill('2');
  await line(page, 'كمامة').locator('[data-uprice]').press('Tab');
  await page.evaluate(async () => { await window.__fake.remoteDelete('suppliers/delta'); await window.__fake.remoteDelete('items/delta-0'); });
  await expect(line(page, 'كمامة')).toContainText('no longer in a price list');
  await expect(totalRow(page)).toContainText('2.00');
  const x = await app.download(page, () => page.locator('#qt-xlsx').click());
  expect(x.rows.find(r => r[1] === 'كمامة طبية 3 طبقات')[5]).toBe(2);
});

test('deleting a saved quote needs a second click', async ({ page, openApp }) => {
  await start(openApp, page, { quotes: { 'q-old': { customer: 'Old customer', date: '2026-09-01', notes: '', lines: [], updated: '2026-09-01T00:00:00Z' } } });
  const del = page.locator('[data-delq="q-old"]');
  await del.click();
  await expect(del).toHaveText('Click again');
  await del.click();
  await expect(app.toast(page)).toHaveText('Quote deleted');
  await expect(page.locator('#view')).not.toContainText('Old customer');
});

test('customer Excel file: company, customer, lines, total and notes', async ({ page, openApp }) => {
  await start(openApp, page, { settings: { company: 'Omega Medical', currency: 'EGP' } });
  await page.locator('#qt-cust').fill('عيادة/النور');
  await page.locator('#qt-date').fill('2026-10-20');
  await page.locator('#qt-notes').fill('Valid 7 days');
  await add(page, 'جاون', 'جاون عزل XL');
  await line(page, 'جاون').locator('[data-qty]').fill('3');
  await line(page, 'جاون').locator('[data-qty]').press('Tab');
  const x = await app.download(page, () => page.locator('#qt-xlsx').click());
  expect(x.name).toBe('Quote عيادةالنور 2026-10-20.xlsx');
  expect(x.rows[0][0]).toBe('Omega Medical');
  expect(x.rows[2].slice(0, 2)).toEqual(['العميل / Customer', 'عيادة/النور']);
  expect(x.rows[5]).toEqual(['#', 'اسم المنتج / Product', 'التفاصيل / Details', 'الوحدة / Unit', 'الكمية / Qty', 'سعر الوحدة / Unit price (EGP)', 'الإجمالي / Total (EGP)']);
  expect(x.rows[6]).toEqual([1, 'جاون عزل XL', 'الجرام: 35', '', 3, 48, 144]);
  expect(x.rows[7].slice(1)).toEqual(['الإجمالي / Total', '', '', '', '', 144]);
  expect(x.rows[9].slice(0, 2)).toEqual(['ملاحظات / Notes', 'Valid 7 days']);
});
