import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 45000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: 'http://127.0.0.1:8081', headless: true, viewport: { width: 1280, height: 800 }, trace: 'off' },
  webServer: { command: 'node ../scripts/serve-local.mjs', url: 'http://127.0.0.1:8081', reuseExistingServer: !process.env.CI },
});
