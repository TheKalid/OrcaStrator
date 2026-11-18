// Added by OrcaStrator to improve coverage: no ticket checks that private pages
// are protected. An anonymous visitor must be sent to the login page, and a
// signed-in user must reach them.
import { test, expect } from '@playwright/test';

const env = (name) => process.env[name] ?? '';
const email = () => env('TEST_USER_EMAIL') || 'demo@orca.dev';
const password = () => env('TEST_USER_PASSWORD') || 'orca123';

test.describe('Access control', { tag: ['@regression', '@security'] }, () => {
  test('anonymous visitor to the dashboard is sent to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('anonymous visitor to the cart is sent to login', async ({ page }) => {
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('signed-in user can open the cart', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email());
    await page.getByTestId('login-password').fill(password());
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId('cart-total')).toBeVisible();
  });

  test('a failed sign-in does not open private pages', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email());
    await page.getByTestId('login-password').fill('not-the-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});
