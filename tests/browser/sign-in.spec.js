// Start-up and sign-in: missing settings, a failed load, signing in and out, and accounts not on the team list.
const { test, expect, seed, app } = require('../support/app');
const { nile } = require('../fixtures/sample-data');

test('asks for the Firebase settings when firebase-config.js still has the placeholder', async ({ page, openApp }) => {
  await openApp({ unconfigured: true });
  await expect(page.locator('#view h2')).toHaveText('Almost ready');
});

test('says so when the sign-in service does not load', async ({ page, openApp }) => {
  await openApp({ noFirebase: true });
  await expect(page.locator('#view h2')).toHaveText('Could not load');
});

test('signed out: shows the sign-in screen, then loads the data after signing in', async ({ page, openApp }) => {
  await openApp({ user: null, docs: seed({ suppliers: [nile] }) });
  await expect(page.locator('#view h2')).toHaveText('Sign in to Supply Price Desk');
  await expect(page.locator('#who')).toBeHidden();
  await page.locator('#signin').click();
  await app.ready(page);
  await expect(page.locator('#who-email')).toHaveText('tester@example.com');
  await expect(page.locator('#sub')).toHaveText('6 products from 1 suppliers');
});

test('sign out goes back to the sign-in screen', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  await page.locator('#signout').click();
  await expect(page.locator('#view h2')).toHaveText('Sign in to Supply Price Desk');
  await expect(page.locator('#who')).toBeHidden();
  // tabs do nothing while signed out
  await app.tab(page, 'settings');
  await expect(page.locator('#view h2')).toHaveText('Sign in to Supply Price Desk');
});

test('an account that is not on the team list is told so and can switch account', async ({ page, openApp }) => {
  await openApp({ user: { email: 'stranger@example.com' }, docs: seed({ suppliers: [nile] }) });
  await expect(page.locator('#view')).toContainText('stranger@example.com is not on this team\'s list');
  await expect(page.locator('#signin')).toHaveText('Use another Google account');
  await page.evaluate(() => { window.__fake.nextSignIn = { email: 'tester@example.com' }; });
  await page.locator('#signin').click();
  await app.ready(page);
  await expect(page.locator('#who-email')).toHaveText('tester@example.com');
});

test('team emails are matched without caring about capital letters', async ({ page, openApp }) => {
  await openApp({ user: { email: 'Tester@Example.com' }, team: ['tester@example.com'], docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
});

test('a blocked sign-in window shows a message instead of failing silently', async ({ page, openApp }) => {
  await openApp({ user: null });
  await page.evaluate(() => { window.__fake.nextSignIn = { error: 'auth/unauthorized-domain' }; });
  await page.locator('#signin').click();
  await expect(app.toast(page)).toContainText('This web address is not allowed yet');
});

test('an empty database shows how to start and the button opens Suppliers', async ({ page, openApp }) => {
  await openApp({ docs: {} });
  await expect(page.locator('#view h2')).toHaveText('No price lists yet');
  await page.locator('[data-go="suppliers"]').click();
  await expect(page.locator('#import h2')).toHaveText('Add a supplier price list');
});

test('changes made by someone else show up live', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  await page.evaluate(() => window.__fake.remoteSet('settings/main', { defaultMargin: 0.5 }, true));
  await expect(page.locator('.stat').nth(2)).toContainText('50%');
});

test('a failed save tells the person', async ({ page, openApp }) => {
  await openApp({ docs: seed({ suppliers: [nile] }) });
  await app.ready(page);
  await page.evaluate(() => window.__fake.failNextWrite('unavailable'));
  await app.tab(page, 'settings');
  await page.locator('#st-co').fill('Omega');
  await page.locator('#st-co').press('Tab');
  await expect(app.toast(page)).toHaveText('Could not save that change. Check your connection and try again.');
  await page.evaluate(() => window.__fake.failNextWrite('resource-exhausted'));
  await page.locator('#st-co').fill('Omega 2');
  await page.locator('#st-co').press('Tab');
  await expect(app.toast(page)).toContainText('The free daily limit was reached');
});
