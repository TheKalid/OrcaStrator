// Smoke suite: is the application up and are its key pages and APIs answering?
// Keep these fast and free of test data, so they can run after every deployment.
import { test, expect } from '@playwright/test';

test.describe('Smoke', { tag: '@smoke' }, () => {
  test('health endpoint reports ok', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe('ok');
  });

  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('home-title')).toBeVisible();
  });

  test('login page shows the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeEnabled();
  });

  test('products API answers with a catalog', async ({ request }) => {
    const res = await request.get('/api/products');
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray((await res.json()).items)).toBeTruthy();
  });
});
