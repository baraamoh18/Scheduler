// Browser tests for the site. Run with: npm install, then npm test
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'tests/browser',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'Africa/Cairo',
    // Chromium on Linux names downloads "download" when the system locale can't hold Arabic letters
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } },
  },
});
