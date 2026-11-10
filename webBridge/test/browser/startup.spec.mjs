import { test, expect } from '@playwright/test';

test('unconfigured startup renders safely without runtime exceptions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/config.json', (route) => route.fulfill({ status: 404, body: 'Not configured' }));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Tab');
  await expect(page.getByText('A little space for your Mandarin.', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Sign-in is temporarily unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('browser-only configuration reaches Google login without contacting backend', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/config.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    firebase: { apiKey: 'synthetic-test-key', authDomain: 'example.invalid', projectId: 'demo-kumalingo', appId: 'synthetic-id' },
    apiBaseUrl: 'https://worker.example.invalid', googleClientId: '123-test.apps.googleusercontent.com',
  }) }));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30000 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByText('Sign-in is temporarily unavailable.', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
