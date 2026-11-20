import { test, expect } from '@playwright/test';

test('playground opens a Try it demo and shows real progress', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.goto('http://127.0.0.1:4380/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Progress & async/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option', { name: 'Open a project' })).toBeVisible();
  await page.keyboard.press('Enter');
  for (const [option, percentage] of [['Design', '0%'], ['Website', '33%'], ['main', '67%']]) {
    await expect(dialog.getByText(new RegExp(`· ${percentage}`))).toBeVisible();
    await dialog.getByRole('option', { name: option }).click();
  }
  await expect(dialog.getByText('· 100%')).toBeVisible({ timeout: 5000 });
  await expect(dialog.getByRole('heading', { name: /Project opened/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.activity')).toContainText('Project opened');
  expect(errors).toEqual([]);
});
