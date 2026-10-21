// The matching word lists: Settings > Matching words, remembering words after linking a pair,
// and search reading names the same way.
const { test, expect, seed, app } = require('../support/app');

const a = { id: 'a', name: 'Omega', rows: [['كانيولا ١٨خضراء', 6], ['فولي 12', 24], ['جهاز سكر اونكول', 300], ['دريسنج لاصق 10*12', 2]] };
const b = { id: 'b', name: 'Stock', rows: [['كانيولا اخضر 18', 6.2], ['قسطرة فولى 12', 25], ['جهاز سكر ساندا', 290], ['غيار جراحي لاصق 10*12', 1.4]] };
const matchRow = (page, text) => page.locator('.match-row', { hasText: text });

test('the starting lists match colours and same-meaning words; search uses them', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [a, b] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await expect(matchRow(page, 'كانيولا').locator('.chip')).toHaveText('Very likely');
  await expect(matchRow(page, 'غيار جراحي').locator('.chip')).toHaveText('Very likely');
  await app.tab(page, 'compare');
  await page.locator('#cq').fill('درسنج'); // a spelling one letter off, and a synonym
  await expect(page.locator('#view .grid-cell .offer')).toHaveCount(2);
  await page.locator('#cq').fill('كانيولا خضراء');
  await expect(page.locator('#view .grid-cell .offer')).toHaveCount(2);
});

test('linking a pair with different words offers to remember them', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [a, b] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await page.locator('#mlevel').selectOption('all');
  // فولي and قسطرة فولى already mean the same (starting list), so nothing is asked
  await matchRow(page, 'فولي').getByRole('button', { name: 'Same product' }).click();
  await expect(matchRow(page, 'فولي')).toHaveCount(0);
  const dlg = page.locator('#dlg');
  await expect(dlg).not.toBeVisible();
  // اونكول / ساندا: mark one as a brand
  await matchRow(page, 'اونكول').getByRole('button', { name: 'Same product' }).click();
  await expect(dlg).toContainText('Remember these words?');
  await expect(dlg.locator('#lr-same')).toBeDisabled();
  await dlg.locator('[data-lword="اونكول"]').click();
  await dlg.locator('#lr-brand').click();
  await expect.poll(async () => (await app.doc(page, 'settings/main')).words.brands).toMatch(/\nاونكول$/);
});

test('picking a word on each side saves them as the same word', async ({ page, openApp }) => {
  const c = { id: 'c', name: 'C', rows: [['رباط ضاغط مرن 10', 5]] }, d = { id: 'd', name: 'D', rows: [['رباط ضاغط باندج 10', 6]] };
  await openApp({ docs: seed({ suppliers: [c, d] }) });
  await app.ready(page);
  await app.tab(page, 'matching');
  await page.locator('#mlevel').selectOption('all');
  await matchRow(page, 'مرن').getByRole('button', { name: 'Same product' }).click();
  const dlg = page.locator('#dlg');
  await dlg.locator('[data-lword="مرن"]').click();
  await dlg.locator('[data-lword="باندج"]').click();
  await expect(dlg.locator('#lr-brand')).toBeDisabled();
  await dlg.locator('#lr-same').click();
  await expect(dlg).not.toBeVisible();
  await expect.poll(async () => (await app.doc(page, 'settings/main')).words.same).toMatch(/\nمرن = باندج$/);
});

test('Settings > Matching words: edit, save, and go back to the starting lists', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [a, b] }) });
  await app.ready(page);
  await app.tab(page, 'settings');
  await expect(page.locator('#mw-brands')).toHaveValue(/ميراج/);
  await page.locator('#mw-brands').fill('اونكول\nساندا');
  await page.locator('#mw-save').click();
  await expect.poll(async () => (await app.doc(page, 'settings/main')).words.brands).toBe('اونكول\nساندا');
  await app.tab(page, 'matching');
  await page.locator('#mlevel').selectOption('all');
  await expect(matchRow(page, 'كانيولا')).toHaveCount(1);
  await expect(matchRow(page, 'اونكول')).toHaveCount(0); // two different brands: never suggested
  await app.tab(page, 'settings');
  await page.locator('#mw-reset').click();
  await page.locator('#mw-reset').click();
  await expect.poll(async () => (await app.doc(page, 'settings/main')).words).toBeUndefined();
  await expect(page.locator('#mw-brands')).toHaveValue(/ميراج/);
});
