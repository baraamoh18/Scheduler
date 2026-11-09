// The Matching tab (suggested pairs, Same product / Different, levels, search, show more)
// and the Compare tab (one item's price at each supplier).
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

test('compare: search, pick one item, its prices run cheapest first and a guess can be confirmed', async ({ page, openApp }) => {
  await start(openApp, page);
  await app.tab(page, 'compare');
  await expect(page.locator('#view table')).toHaveCount(0);
  await page.locator('#cq').fill('شاش');
  await expect(page.locator('#view thead th')).toHaveText(['Item', 'Supplier', 'Price', 'Other prices']);
  await expect(page.locator('#view tbody tr')).toHaveCount(3); // one row per item, sizes are not grouped
  await expect(page.locator('#view tbody tr', { hasText: 'شاش طبي 10' }).locator('td').last()).toHaveText('1');
  await expect(page.locator('#view tbody tr', { hasText: 'شاش طبي 7.5' }).locator('td').last()).toHaveText('none');
  await page.locator('#view [data-cpick]', { hasText: 'شاش طبي 10' }).click();

  await expect(page.locator('#view thead th')).toHaveText(['Supplier', 'Item', 'Price', 'Same item?']);
  const rows = page.locator('#view tbody tr');
  await expect(rows.locator('td:first-child')).toHaveText(['الدلتا للمستلزمات', 'النيل الطبية']); // 22 before 25
  await expect(rows.first()).toHaveClass('cheapest');
  await expect(rows.first().locator('.chip.best')).toHaveText('cheapest');
  await expect(rows.first().locator('.chip.lvl-high')).toHaveText('Very likely');
  await expect(rows.last().locator('.chip')).toHaveText('This item');

  // nothing is linked until a person says so
  expect((await app.doc(page, 'matching/links'))?.map || {}).toEqual({});
  await rows.first().getByRole('button', { name: 'Same product' }).click();
  await expect(rows.locator('.chip', { hasText: 'Linked' })).toHaveCount(2);
  await expect(rows.first().locator('.chip.best')).toHaveText('cheapest');
  await expect.poll(async () => Object.keys((await app.doc(page, 'matching/links')).map)).toHaveLength(1);

  await page.locator('#cback').click();
  await expect(page.locator('#view thead th').first()).toHaveText('Item');
});

test('compare: price warnings, weak guesses hidden until asked for, and a new search', async ({ page, openApp }) => {
  const a = { id: 'a', name: 'A', rows: [['كانيولا جرين 18', 2], ['بلاستر فريد 10 سم', 5]] };
  const b = { id: 'b', name: 'B', rows: [['كانيولا جرين 18', 12], ['بلاستر فريد', 50]] };
  await openApp({ docs: seed({ suppliers: [a, b] }) });
  await app.ready(page);
  await app.tab(page, 'compare');
  await page.locator('#cq').fill('كانيولا');
  await page.locator('#view [data-cpick]').first().click();
  await expect(page.locator('#view tbody tr').last()).toContainText('so check the pack or unit');

  await page.locator('#cq').fill('بلاستر');
  await expect(page.locator('#view thead th').first()).toHaveText('Item'); // typing leaves the picked item
  await expect(page.locator('#view tbody tr').first().locator('td').last()).toHaveText('none'); // a weak guess is not counted
  await page.locator('#view [data-cpick]', { hasText: 'بلاستر فريد 10' }).click();
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await expect(page.locator('#view .note')).toContainText('Only weak guesses');
  await page.locator('#cweak').check();
  await expect(page.locator('#view tbody tr')).toHaveCount(2);
  await expect(page.locator('#view .chip.lvl-low')).toHaveText('Weak');
});

test('compare: an item only one supplier sells, no results and too many results', async ({ page, openApp }) => {
  const many = { id: 'm', name: 'Many', rows: [['قطن طبي', 9], ...Array.from({ length: 401 }, (_, i) => ['جوانتي ' + i, 1])] };
  await openApp({ docs: seed({ suppliers: [nile, delta, many] }) });
  await app.ready(page);
  await app.tab(page, 'compare');
  await page.locator('#cq').fill('قطن');
  await page.locator('#view [data-cpick]').first().click();
  await expect(page.locator('#view .note')).toContainText('No other supplier seems to sell this item.');
  await expect(page.locator('#view .chip.best')).toHaveCount(0);
  await page.locator('#cq').fill('غير موجود');
  await expect(page.locator('#view .panel.empty')).toContainText('No items contain this.');
  await page.locator('#cq').fill('جوانتي');
  await expect(page.locator('#view .panel.empty')).toContainText('402 items contain this word.'); // قفاز جراحي counts too: it means the same as جوانتي
});
