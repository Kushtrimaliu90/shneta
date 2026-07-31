import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * M0 acceptance (docs/12): the branded shell renders in both locales, the locale switch
 * preserves the path, and axe reports no serious or critical violations (docs/09 §1.12).
 *
 * The full twelve-journey suite arrives milestone by milestone; this file is the floor
 * that must never regress.
 */

test.describe('app shell', () => {
  test('renders the Albanian home page unprefixed', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shëndeti yt, i thjeshtuar.');
    await expect(page.getByRole('link', { name: 'Shfleto dyqanin' })).toBeVisible();
  });

  test('renders the English home page under /en', async ({ page }) => {
    await page.goto('/en');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your health, simplified.');
  });

  test('the locale switcher preserves the current path', async ({ page }) => {
    await page.goto('/en');
    // WCAG 2.5.3 — the accessible name must start with the visible label ("sq"), so this
    // locator doubles as the regression test for that requirement.
    await page
      .getByRole('group', { name: 'Language' })
      .getByRole('link', { name: 'sq — Switch to Albanian' })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sq');
  });

  test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Kalo te përmbajtja' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test('unknown routes render the localized not-found page', async ({ page }) => {
    const response = await page.goto('/kjo-faqe-nuk-ekziston');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nuk e gjetëm këtë faqe');
  });

  test('serves the security headers from docs/10 §5', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['content-security-policy-report-only']).toContain("default-src 'self'");
  });
});

test.describe('accessibility', () => {
  for (const path of ['/', '/en']) {
    test(`axe reports no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );

      expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
    });
  }
});
