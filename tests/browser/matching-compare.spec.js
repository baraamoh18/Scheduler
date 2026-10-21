// The Matching tab (suggested pairs, Same product / Different, levels, search, show more)
// and the Compare tab (one kind of item by size and supplier).
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');

const matchRow = (page, text) => page.locator('.match-row', { hasText: text });
async function start(openApp, page, extra = {}) {
  await openApp({ docs: seed({ suppliers: [nile, delta], ...extra }) });
  await app.ready(page);
}

test('suggested pairs: count, levels and reasons', async ({ page, openApp }) => {
  await start(openApp, page);
  await expect(page.locator('#cnt-match')).toHaveText('3');
  await app.tab(page, 'matching');
  await expect(page.locator('.stat b').first()).toHaveText('3');
  await expect(page.locator('.match-row')).toHaveCount(3);
  const gauze = matchRow(page, 'شاش طبي 10');
  await expect(gauze.locator('.chip')).toHaveText('Very likely');
  await expect(gauze).toContainText('100% alike');
  await expect(gauze).toContainText('✓ Same size 10 × 10');
});

test('Same product links the pair and it leaves the list', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'matching');
  await matchRow(page, 'سرنجة').getByRole('button', { name: 'Same product' }).click();
  await expect(page.locator('.match-row')).toHaveCount(2);
  await expect(page.locator('#cnt-match')).toHaveText('2');
  await expect(page.locator('#sub')).toHaveText('10 products from 2 suppliers');
  await expect.poll(async () => Object.keys((await app.doc(page, 'matching/links')).map)).toHaveLength(1);
});

test('Different hides the pair, and it stays hidden after a reload', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'matching');
  await matchRow(page, 'رباط').getByRole('button', { name: 'Different' }).click();
  await expect(page.locator('.match-row')).toHaveCount(2);
  await expect.poll(async () => Object.values((await app.doc(page, 'matching/dismissed')).map)).toEqual([true]);
  await page.reload();
  await app.ready(page);
  await expect(page.locator('#cnt-match')).toHaveText('2');
});

test('levels: only very likely, or all including weak; a search shows every level', async ({ page, openApp }) => {
  const weak = { id: 'w', name: 'Weak Co', rows: [['شاش قطني 10 سم × 10 سم', 30]] };
  await openApp({ docs: seed({ suppliers: [nile, delta, weak] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  const total = await page.locator('.match-row').count();
  await page.locator('#mlevel').selectOption('all');
  const all = await page.locator('.match-row').count();
  expect(all).toBeGreaterThanOrEqual(total);
  await page.locator('#mlevel').selectOption('high');
  await expect(page.locator('.match-row .chip:not(.lvl-high)')).toHaveCount(0);
  await page.locator('#mq').fill('سرنجه');
  await expect(page.locator('.match-row')).toHaveCount(1);
  await expect(page.locator('#mlevel')).toBeDisabled();
  await expect(page.locator('#mq')).toBeFocused();
  await page.locator('#mq').fill('لا شيء');
  await expect(page.locator('.tablebox .empty')).toContainText('No items from different suppliers look alike for this search.');
});

test('nothing to match shows a hint', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await expect(page.locator('.tablebox .empty')).toContainText('No likely matches between your suppliers right now.');
});

test('long lists show 80 pairs at a time', async ({ page, openApp }) => {
  // made-up words so each pair is unique: "Probe kab 1" / "Probe kab 1"
  const code = i => 'k' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
  const rows = Array.from({ length: 100 }, (_, i) => [`Probe ${code(i)} ${i + 1}`, 10]);
  await openApp({ docs: seed({ suppliers: [{ id: 'x', name: 'X', rows }, { id: 'y', name: 'Y', rows }] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await expect(page.locator('.match-row')).toHaveCount(80);
  await expect(page.locator('#view .pager')).toContainText('80 of 100 shown');
  await page.locator('#mmore').click();
  await expect(page.locator('.match-row')).toHaveCount(100);
  await expect(page.locator('#mmore')).toHaveCount(0);
});

test('after importing a second supplier the Matching tab opens by itself', async ({ page, openApp }, info) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  await app.tab(page, 'suppliers');
  await page.locator('#im-name').fill('الدلتا');
  await page.setInputFiles('#im-file', app.xlsxFile(info, 'delta.xlsx', [['الصنف', 'السعر'], ...delta.rows.map(r => [r[0], r[1]])]));
  await page.locator('#mp-go').click();
  await expect(page.locator('#tabs [aria-selected="true"]')).toHaveText(/Matching/);
  await expect(page.locator('.match-row')).toHaveCount(3);
});

test('compare: sizes down the side, suppliers across, the cheapest marked', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'compare');
  await expect(page.locator('#view table')).toHaveCount(0);
  await page.locator('#cq').fill('شاش');
  await expect(page.locator('#view thead th')).toHaveText(['Size', 'النيل الطبية', 'الدلتا للمستلزمات']);
  await expect(page.locator('#view tbody td.size')).toHaveText(['7.5', '10 × 10']);
  const ten = page.locator('#view tbody tr', { hasText: '10 × 10' });
  await expect(ten.locator('.offer.cheapest')).toContainText('22.00');
  await expect(ten.locator('.chip.best')).toHaveText('cheapest');
  await expect(page.locator('#view .pager')).toContainText('3 items in 2 sizes from 2 suppliers');
  await page.locator('#cmulti').check();
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  // open an item from the grid, link it, and the grid says linked
  await ten.locator('.offer button').first().click();
  await page.locator('#pd-results').getByRole('button', { name: 'Same product' }).first().click();
  await page.locator('#dlg [data-close]').click();
  await expect(ten.locator('.chip', { hasText: 'linked' })).toHaveCount(2);
});

test('compare: letter sizes, no-size rows, no results and too many results', async ({ page, openApp }) => {
  const many = { id: 'm', name: 'Many', rows: [['قطن طبي', 9], ...Array.from({ length: 401 }, (_, i) => ['جوانتي ' + i, 1])] };
  await openApp({ docs: seed({ suppliers: [nile, delta, many] }) });
  await app.ready(page);
  await app.tab(page, 'compare');
  await page.locator('#cq').fill('جاون');
  await expect(page.locator('#view tbody td.size')).toHaveText(['35 جم XL']); // the grams detail is shown with the size
  await page.locator('#cq').fill('قطن');
  await expect(page.locator('#view tbody td.size')).toHaveText(['No size in name']);
  await page.locator('#cq').fill('كمامة');
  await expect(page.locator('#view tbody td.size')).toHaveText(['3']);
  await page.locator('#cmulti').check();
  await expect(page.locator('#view .panel.empty')).toContainText('No size is sold by more than one supplier.');
  await page.locator('#cmulti').uncheck();
  await page.locator('#cq').fill('غير موجود');
  await expect(page.locator('#view .panel.empty')).toContainText('No items contain this.');
  await page.locator('#cq').fill('جوانتي');
  await expect(page.locator('#view .panel.empty')).toContainText('402 items contain this word.'); // قفاز جراحي counts too: it means the same as جوانتي
});
