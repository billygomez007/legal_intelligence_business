import { expect, test } from '@playwright/test';
const routes = [
  ['dashboard', '/', 'A clearer view of the law.'],
  ['ask', '/ask', 'Ask the Law'],
  ['search', '/search', 'Search the law'],
  ['case', '/cases/sample-contract', 'Sample Contract Dispute'],
  ['legislation', '/legislation/example-companies', 'Example Companies Act Provision'],
  ['research', '/research/sample-contract-research', 'Sample Contract Dispute'],
  ['library', '/library', 'Library'],
  ['alerts', '/alerts', 'Legal alerts'],
  ['organization', '/organization', 'Organization'],
  ['settings', '/settings', 'Settings'],
] as const;
for (const [name, path, heading] of routes) {
  test(`${name}: desktop, mobile and clean browser console`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByText('Demonstration data', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${name}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}-mobile.png`), fullPage: true });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test('search filters, empty results, and source citation navigation', async ({ page }) => {
  await page.goto('/search');
  await page.getByLabel('Document type').selectOption('legislation');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByText('1 demonstration result · Local fixture filtering only'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Example Companies Act Provision', exact: true }).click();
  await page.getByRole('link', { name: 'Section 1 · Example scope' }).click();
  await expect(page.locator('#demo-provision-1')).toBeVisible();
  await page.goto('/search?q=no-such-record');
  await expect(
    page.getByRole('heading', { name: 'No demonstration authorities match' }),
  ).toBeVisible();
});
test('Ask abstains and the example citation opens its actual fixture passage', async ({ page }) => {
  await page.goto('/ask');
  await page.getByLabel('Your research question').fill('A question that has not been researched');
  await page.getByRole('button', { name: 'Preview research workflow' }).click();
  await expect(page.getByText('No legal answer was generated')).toBeVisible();
  await page.getByRole('button', { name: 'View fixed demonstration answer' }).click();
  await expect(page.getByRole('region', { name: 'AI synthesis example' })).toBeVisible();
  await page.getByRole('link', { name: 'DEMO-CASE-001 · example paragraph 1' }).click();
  await expect(page.locator('#demo-contract-1')).toBeVisible();
});
test('keyboard command search, skip link and unknown/restricted records', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Search pages')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.goto('/cases/missing');
  await expect(page.getByRole('heading', { name: 'This record isn’t available' })).toBeVisible();
  await page.goto('/sources/sample-employment');
  await expect(page.getByText('Rights restricted', { exact: true })).toBeVisible();
  await expect(page.locator('blockquote')).toHaveCount(0);
});
