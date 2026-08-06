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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Biologjia jote ka një kod.');
    // Scoped to the hero: the bestsellers section carries the same CTA (docs/05 §1.5).
    await expect(page.getByRole('link', { name: 'Shiko produktet' }).first()).toBeVisible();
  });

  test('renders the English home page under /en', async ({ page }) => {
    await page.goto('/en');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your biology has a code.');
  });

  test('the locale switcher preserves the current path', async ({ page }) => {
    await page.goto('/en');

    // docs/04 §6 — below 1024px the navbar collapses and the switcher moves into the
    // full-screen sheet. Follow whichever path this viewport actually offers, so the test
    // covers the real journey on desktop and mobile rather than only the wide one.
    const openMenu = page.getByRole('button', { name: 'Open menu' });
    if (await openMenu.isVisible()) await openMenu.click();

    // WCAG 2.5.3 — the accessible name must start with the visible label ("sq"), so this
    // locator doubles as the regression test for that requirement.
    await page
      .getByRole('link', { name: 'sq — Switch to Albanian' })
      .filter({ visible: true })
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

/**
 * The header must never become a containing block for its overlays.
 *
 * `backdrop-filter: blur(8px)` sat on the sticky header for months. `backdrop-filter` makes an element
 * a containing block for `position: fixed` descendants — the same rule `transform` and `filter` follow —
 * and both overlays mounted in the header are `fixed inset-0`. So they resolved against the header's own
 * box instead of the viewport: the mobile menu measured **390 × 64** on a phone, opening as a 64-pixel
 * strip with the page showing through beneath it.
 *
 * It reads exactly like a z-index bug and is not one, which is why this asserts **geometry** rather than
 * stacking. Anything added to the header later that establishes a containing block — `transform`,
 * `filter`, `perspective`, `will-change`, `contain: paint` — reproduces it, and fails here first.
 */
test.describe('header overlays escape the header', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'mobile chrome only');

  test('the menu panel fills the viewport, not the header strip', async ({ page, viewport }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Hap menynë' }).click();

    const panel = page.getByRole('dialog').first();
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box?.width).toBe(viewport?.width);
    // The whole bug in one assertion: 64 px is the header, 844 is the screen.
    expect(box?.height).toBe(viewport?.height);

    // And the links inside are reachable rather than clipped out of view. Scoped to the panel: the
    // footer carries the same nav, so an unscoped lookup is ambiguous rather than wrong.
    await expect(panel.getByRole('link', { name: 'Dyqani' })).toBeVisible();
  });

  test('the header establishes no containing block for fixed children', async ({ page }) => {
    await page.goto('/shop');

    const trapping = await page.evaluate(() => {
      const header = document.querySelector('header');
      if (!header) return 'no header';
      const cs = getComputedStyle(header);
      // Every property that makes an element a containing block for `position: fixed`.
      const offenders: string[] = [];
      if (cs.backdropFilter !== 'none') offenders.push(`backdrop-filter: ${cs.backdropFilter}`);
      if (cs.filter !== 'none') offenders.push(`filter: ${cs.filter}`);
      if (cs.transform !== 'none') offenders.push(`transform: ${cs.transform}`);
      if (cs.perspective !== 'none') offenders.push(`perspective: ${cs.perspective}`);
      if (cs.contain.includes('paint') || cs.contain.includes('layout')) {
        offenders.push(`contain: ${cs.contain}`);
      }
      if (cs.willChange !== 'auto') offenders.push(`will-change: ${cs.willChange}`);
      return offenders.join(', ');
    });

    expect(trapping, 'the header traps its fixed overlays').toBe('');
  });

  test('the search overlay opens over the page', async ({ page, viewport }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Hap kërkimin' }).click();

    const form = page.getByRole('search');
    await expect(form).toBeVisible();

    // Spans the screen rather than being boxed into the header's content width.
    const box = await form.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan((viewport?.width ?? 390) * 0.8);
  });
});
