const { defineConfig } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3462';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'ui.test.js',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node tests/start-ui-server.js',
        url: 'http://127.0.0.1:3462/api/health',
        timeout: 30000,
        reuseExistingServer: false,
      },
});
