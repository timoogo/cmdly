import { test, expect } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function docPaths(dir, root = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await docPaths(file, root));
    else if (entry.name.endsWith('.mdx')) {
      let path = relative(root, file).replace(/\\/g, '/').replace(/\.mdx$/, '');
      if (path === 'index') path = '';
      else path = path.replace(/\/index$/, '');
      paths.push(`/docs${path ? `/${path}` : ''}`);
    }
  }
  return paths.sort();
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page._cmdlyErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page._cmdlyErrors).toEqual([]); });

test('home and all documentation pages load directly with metadata', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Commands that go further.' })).toBeVisible();
  await expect(page).toHaveTitle(/Cmdly/);
  const paths = await docPaths(new URL('../content/docs', import.meta.url).pathname);
  expect(paths).toHaveLength(22);
  for (const path of paths) {
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('h1'), path).toBeVisible();
    await expect(page, path).toHaveTitle(/Cmdly/);
  }
});

test('sidebar navigates between all 22 pages', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/docs', { waitUntil: 'networkidle' });
  const sections = { 'getting-started': 'Getting Started', core: 'Core', registries: 'Registries', react: 'React', advanced: 'Advanced', api: 'API Reference' };
  const paths = await docPaths(new URL('../content/docs', import.meta.url).pathname);
  for (const path of paths) {
    const sidebar = page.getByRole('complementary').first();
    const section = path.split('/')[2];
    if (section) {
      const group = sidebar.getByRole('button', { name: sections[section], exact: true });
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    }
    await sidebar.locator(`a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?$'));
    await expect(page.locator('h1')).toBeVisible();
  }
});

test('navigation, search, keyboard and code copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /^Installation Install/ }).click();
  await expect(page).toHaveURL(/getting-started\/installation/);
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search' });
  await expect(search).toBeFocused();
  await search.fill('runtimeRequired');
  const result = page.getByRole('option').filter({ hasText: 'Context, Runtime and Sessions' }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/registries\/context-sessions/);
  await page.goto('/docs/getting-started/first-command', { waitUntil: 'networkidle' });
  const copy = page.getByRole('button', { name: 'Copy Text' }).first();
  await copy.focus(); await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('createCommandEngine');
  await page.getByRole('button', { name: 'Copy Markdown' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Your First Command');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('theme toggles and persists after reload', async ({ page }) => {
  await page.goto('/docs', { waitUntil: 'networkidle' });
  const toggle = page.getByRole('button', { name: 'Toggle Theme' }).first();
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await toggle.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
  await page.reload({ waitUntil: 'networkidle' });
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
});

test('mobile navigation opens and follows a link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs', { waitUntil: 'networkidle' });
  const open = page.getByRole('button', { name: 'Open Sidebar' });
  await open.click();
  await expect(page.getByRole('button', { name: 'Close Sidebar' }).first()).toHaveAttribute('aria-expanded', 'true');
  const sidebar = page.locator('#nd-sidebar-mobile');
  await sidebar.getByRole('button', { name: 'Getting Started' }).click();
  await sidebar.getByRole('link', { name: 'Quick Start' }).click();
  await expect(page).toHaveURL(/getting-started\/quick-start/);
  await expect(page.getByRole('heading', { name: 'Quick Start', level: 1 })).toBeVisible();
});
