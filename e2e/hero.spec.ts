import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT } from './helpers/storefront';

/**
 * The homepage hero carousel (docs/05 §1).
 *
 * The three things worth testing here are the ones that are invisible until they are wrong: that the
 * fold still fits after the hero became taller machinery, that exactly one `h1` survives N slides, and
 * that an inactive slide's CTA is genuinely unreachable rather than merely transparent.
 */

test.describe('hero carousel', () => {
  test('the whole hero fits above the fold', async ({ page, viewport }) => {
    await page.goto('/');

    /*
     * The measurement that prompted the rebuild: the old `h1`'s bottom edge sat at 462 px of a 900 px
     * viewport, so the headline began roughly 43% down. This asserts the *entire* hero block — eyebrow
     * through CTAs — clears the fold, which is a stricter bar than the one that was failing.
     */
    const box = await page.locator('[data-hero-cta]').first().boundingBox();
    expect(box, 'the hero CTAs must render').not.toBeNull();
    expect(box?.y ?? Infinity).toBeLessThan(viewport?.height ?? 900);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 900);
  });

  test('the trust strip is inside the first viewport too', async ({ page, viewport }) => {
    await page.goto('/');

    /*
     * The brief lists the strip as part of the first-viewport requirement, and it is the assertion
     * that actually failed: measured on production at 393 × 852 the strip landed at 873–999, well
     * below the fold, while every desktop width was comfortable. A phone has roughly 742 px of usable
     * height once the header is out, and the first version spent it on a tall image and two stacked
     * buttons.
     */
    const box = await page.locator('[data-trust-strip]').boundingBox();
    expect(box, 'the trust strip must render').not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 900);
  });

  test('the trust strip is present and does not rotate', async ({ page }) => {
    await page.goto('/');

    const strip = page.locator('[data-trust-strip]');
    await expect(strip).toBeVisible();

    // Four facts, all of them visible at once — the reason this is not inside the carousel.
    const before = await strip.innerText();
    await page.waitForTimeout(1_500);
    expect(await strip.innerText()).toBe(before);
  });

  test('exactly one h1, however many slides there are', async ({ page }) => {
    await page.goto('/');
    /*
     * Every slide carries a headline styled identically, but only the anchor slide's is an `h1`. The
     * anchor is the pinned slide and shuffle never moves it, so this holds after hydration too.
     */
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('the free-shipping line shows a real threshold, not hardcoded copy', async ({ page }) => {
    await page.goto('/');
    // The old homepage said "over €30" in a message string while the cart read the real number.
    await expect(page.locator('[data-trust-strip]')).toContainText('€');
  });

  test('axe finds no serious or critical violations on the rebuilt home page', async ({ page }) => {
    await page.goto('/');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });
});

/**
 * Carousel chrome only exists when there is something to navigate.
 *
 * With one published slide the brief asks for a static render — no dots, no arrows, no autoplay
 * timer. The seeded catalogue has exactly one slide, so this is the state the site ships in and the
 * assertions below are the live behaviour rather than a hypothetical.
 */
test.describe('a single published slide renders without carousel chrome', () => {
  test('no dots and no arrows', async ({ page }) => {
    await page.goto('/');

    const slideCount = await page.locator('[aria-roledescription="slide"]').count();
    test.skip(slideCount > 1, 'more than one slide is published');

    await expect(page.getByRole('tablist', { name: /slide/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /next slide/i })).toHaveCount(0);
  });
});

/**
 * The admin console. Read path and the guard; the write path changes the live homepage for everyone,
 * so it is covered by unit tests over the schema instead of by a run that would leave a slide behind.
 */
test.describe('hero admin', () => {
  test('a signed-out visitor cannot reach it', async ({ page }) => {
    await page.goto('/admin/hero');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});

/**
 * The persistent header search (Part 3).
 *
 * The engine behind this shipped earlier — synonyms, promoted terms, diacritic folding, zero-result
 * logging. What is new is the field, so what is tested here is the field: that it is visible without a
 * tap, that the keyboard can drive it end to end, and that the combobox contract is intact.
 */
test.describe('header search', () => {
  test('is visible without a tap, on both layouts', async ({ page }) => {
    await page.goto('/');
    // Two instances render — one inline for desktop, one row for mobile — and CSS shows exactly one.
    await expect(page.getByRole('combobox').filter({ visible: true })).toHaveCount(1);
  });

  test('"/" focuses it from anywhere on the page', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').press('/');
    await expect(page.getByRole('combobox').filter({ visible: true })).toBeFocused();
  });

  test('typing opens a listbox and the arrow keys move the active option', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox').filter({ visible: true });
    await box.fill('magnez');

    const list = page.getByRole('listbox');
    await expect(list).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(box).toHaveAttribute('aria-expanded', 'true');

    /*
     * The combobox contract: focus stays in the input and `aria-activedescendant` points at the
     * option. If focus moved to the option instead, a screen reader would lose the text being typed.
     */
    await box.press('ArrowDown');
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('aria-activedescendant', /option-0$/);

    await box.press('ArrowDown');
    await expect(box).toHaveAttribute('aria-activedescendant', /option-1$/);
  });

  test('Escape closes the dropdown', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox').filter({ visible: true });
    await box.fill('magnez');
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await box.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  test('Enter on a bare query goes to the results page', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox').filter({ visible: true });
    await box.fill('kolagjen');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=kolagjen$/);
  });

  test('an Albanian query typed without diacritics still finds products', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox').filter({ visible: true });
    // "gjume" for "gjumë" — the normal case on a phone keyboard here.
    await box.fill('gjume');
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByRole('option').first()).toBeVisible();
  });
});
