import { expect, test } from '@playwright/test';

const pages = [
  ['home', '/', 'The intelligence layer for Ghanaian law.'],
  ['sign-in', '/sign-in', 'Sign-in isn’t available yet.'],
  ['get-started', '/get-started', 'Access isn’t open yet.'],
  ['legal', '/legal', 'What this preview is, and is not.'],
] as const;

for (const [name, path, heading] of pages) {
  test(`${name}: renders at desktop and mobile without overflow or console errors`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${name}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}-mobile.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('homepage labels the environment and offers the safe calls to action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Platform preview', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start researching' }).first()).toHaveAttribute(
    'href',
    '/app',
  );
  await expect(page.getByRole('link', { name: 'Explore the platform' })).toHaveAttribute(
    'href',
    '/#product',
  );
  await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('mobile menu opens from the keyboard, traps focus, and Escape restores it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menu).toBeFocused();
});
