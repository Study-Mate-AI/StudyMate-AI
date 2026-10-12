// Landing page smoke test. Needs the client (npm run dev) on :5173; run: npx playwright test
import { test, expect } from '@playwright/test';

const URL = process.env.BASE_URL || 'http://localhost:5173/';
const SHOTS = process.env.SHOTS || 'test-results';

for (const [name, viewport, scheme] of [['desktop-light', { width: 1366, height: 860 }, 'light'], ['desktop-dark', { width: 1366, height: 860 }, 'dark'], ['mobile', { width: 375, height: 812 }, 'light']]) {
  test(`landing renders cleanly: ${name}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => m.type() === 'error' && !/api\/me|401/.test(m.text()) && errors.push(m.text()));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not the internet');
    await page.waitForTimeout(4500); // let the hero words, highlight sweep and typing finish
    await page.screenshot({ path: `${SHOTS}/landing-${name}-hero.png` });

    // Scroll through so every [data-reveal] block gets revealed, then check none are left hidden.
    for (let y = 0; y < await page.evaluate(() => document.body.scrollHeight); y += 500) { await page.mouse.wheel(0, 500); await page.waitForTimeout(120); }
    await page.waitForTimeout(1200);
    expect(await page.locator('[data-reveal]:not(.in)').count()).toBe(0);
    await page.screenshot({ path: `${SHOTS}/landing-${name}-full.png`, fullPage: true });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Start free opens the signup form', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('link', { name: 'Start free', exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
});

test('Google sign-in button renders', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('iframe[src*="accounts.google.com/gsi/button"]')).toBeVisible({ timeout: 15000 });
});

test('server rejects a fake Google token', async ({ request }) => {
  const r = await request.post(URL + 'api/google', { data: { credential: 'not-a-real-token' } });
  expect(r.status()).toBe(401);
});

for (const path of ['login', 'signup']) {
  test(`Google button on /${path}`, async ({ page }) => {
    await page.goto(URL + path);
    await expect(page.locator('.or')).toBeVisible();
    await expect(page.locator('iframe[src*="accounts.google.com/gsi/button"]')).toBeVisible({ timeout: 15000 });
  });
}
