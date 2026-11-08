import { test, expect } from '@playwright/test';

test('playground opens and runs a command with its React version', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.goto('http://127.0.0.1:4380/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open command palette/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('combobox');
  await search.fill('Review production deployment');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('option', { name: /Staging/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('option', { name: /Europe/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Deployment reviewed')).toBeVisible();
  expect(errors).toEqual([]);
});
