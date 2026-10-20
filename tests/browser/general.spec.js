// Things that apply across the site: unsafe text in price lists, phone-width layout,
// and filters that point at a supplier list that was deleted.
const { test, expect, seed, app } = require('../support/app');
const { nile, delta } = require('../fixtures/sample-data');

test('text from a price list is shown as text, never run as code', async ({ page, openApp }) => {
  const evil = { id: 'e', name: '<b>Evil</b> Co', rows: [['<img src=x onerror="window.__hacked=1">', 5, '<script>window.__hacked=2</script>', '', '<i>cat</i>']] };
  await openApp({ docs: seed({ suppliers: [evil, nile] }) });
  await app.ready(page);
  await expect(page.locator('#view tbody')).toContainText('<img src=x onerror="window.__hacked=1">');
  for (const tab of ['matching', 'compare', 'suppliers', 'quote', 'settings', 'products']) await app.tab(page, tab);
  await page.locator('#q').fill('img');
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await page.locator('#view tbody td.pname button').click();
  await expect(page.locator('#dlg h3').first()).toHaveText('<img src=x onerror="window.__hacked=1">');
  await page.locator('#dlg [data-close]').click();
  await page.locator('[data-addq]').first().click().catch(() => {});
  expect(await page.evaluate(() => window.__hacked)).toBeUndefined();
  await expect(page.locator('#view b', { hasText: 'Evil' })).toHaveCount(0);
});

test('every tab fits a phone screen without sideways scrolling', async ({ page, openApp }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openApp({ docs: seed({ suppliers: [nile, delta] }) });
  await app.ready(page);
  for (const tab of ['products', 'matching', 'compare', 'suppliers', 'quote', 'settings']) {
    await app.tab(page, tab);
    if (tab === 'compare') await page.locator('#cq').fill('شاش');
    await page.waitForTimeout(300);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, tab).toBeLessThanOrEqual(390);
  }
});

test('a "only this supplier" filter is cleared when that list is deleted', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile, delta] }) });
  await app.ready(page);
  await page.locator('#filter').selectOption('sup:delta');
  await expect(page.locator('#view tbody tr')).toHaveCount(5);
  await page.evaluate(async () => { await window.__fake.remoteDelete('suppliers/delta'); await window.__fake.remoteDelete('items/delta-0'); });
  await expect(page.locator('#sub')).toHaveText('6 products from 1 suppliers');
  await expect(page.locator('#view tbody tr')).toHaveCount(6);
  await expect(page.locator('#filter')).toHaveValue('all');
});

test('matching runs again only when lists or links change, not after a margin edit', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile, delta] }) });
  await app.ready(page);
  await page.evaluate(() => { const real = Matcher.suggest; window.__runs = 0; Matcher.suggest = (...a) => { window.__runs++; return real(...a); }; });
  const r = page.locator('#view tbody tr', { hasText: 'سرنجة 5 مل' });
  await r.locator('input.margin').fill('30');
  await r.locator('input.margin').press('Tab');
  await expect(r.locator('td.sell')).toHaveText('3.25');
  await page.evaluate(() => window.__fake.remoteSet('settings/main', { defaultMargin: 0.4 }, true));
  await expect(page.locator('.stat').nth(2)).toContainText('40%');
  expect(await page.evaluate(() => window.__runs)).toBe(0);
  await app.tab(page, 'matching');
  await page.locator('.match-row').first().getByRole('button', { name: 'Different' }).click();
  await expect(page.locator('.match-row')).toHaveCount(2);
  expect(await page.evaluate(() => window.__runs)).toBeGreaterThan(0);
});
