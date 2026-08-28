import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
  ACTION_TIMEOUT,
  CHEAP_PRODUCT,
  ORDER_NUMBER,
  addCheapItemToCart,
  fillCheckout,
} from './helpers/storefront';

/**
 * docs/09 §1 journeys 1, 3 and 4 — the money paths.
 *
 * These place **real orders** against whatever `.env.local` points at, so:
 *   · every email ends in `@biocode.test`, which is the only thing `purgeFixtures` matches,
 *     and `e2e/global-teardown.ts` runs it after the whole run, pass or fail;
 *   · the teardown also writes a compensating `cancel_restock` movement per line, otherwise
 *     each run would permanently eat fixture stock until journey 1 failed for a reason that
 *     has nothing to do with the code.
 *
 * Emails are unique per test rather than shared, so the two Playwright projects (desktop and
 * mobile) and the parallel workers cannot see each other's orders in order lookup.
 */

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) out[match[1]] = match[2].trim();
    }
  } catch {
    /* CI supplies these through process.env */
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY } = env();
const service = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

/**
 * docs/02 §9 limits checkout to 10 attempts per hour and order lookup to 10 per hour, both
 * **per IP** — and every test here would otherwise share localhost. This file alone places
 * eight orders and makes three lookups, so from the tenth attempt onward it starts asserting
 * against "too many attempts" instead of against the checkout. Worse, the window is an hour:
 * one run would poison the next.
 *
 * Each test therefore gets its own forwarded address, which is an accurate model of what
 * these tests represent — several different customers buying — and does not weaken the
 * limiter, whose own budget is still enforced per address.
 *
 * **Range allocation across the E2E suite** — the reserved documentation blocks, one per
 * purpose, because two files sharing a block means one silently spends the other's budget:
 *   · 203.0.113.0/24  (TEST-NET-3) — auth.spec.ts, per-test addresses
 *   · 198.51.100.0/24 (TEST-NET-2) — auth.spec.ts, the fixed addresses its rate-limiter test
 *                                    needs in order to own a budget outright
 *   · 192.0.2.0/24    (TEST-NET-1) — this file
 * Claiming TEST-NET-2 here is precisely what broke the mobile rate-limiter test: these
 * checkout tests spent 198.51.100.2 before it ran.
 */
let addressCounter = 0;

test.beforeAll(async () => {
  // The addresses repeat every run, so without clearing them the suite passes once and then
  // fails for the rest of the hour on its own leftovers.
  await service?.from('rate_limits').delete().like('key', '%:192.0.2.%');
});

test.beforeEach(async ({ page }, testInfo) => {
  addressCounter += 1;
  const octet = ((testInfo.workerIndex * 50 + addressCounter) % 250) + 1;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `192.0.2.${octet}` });
});

/**
 * `ACTION_TIMEOUT`, the product constants and the checkout walk now live in
 * `e2e/helpers/storefront.ts`, shared with `admin.spec.ts` — journey 7 needs a real order to
 * operate on, and two definitions of "place an order" would drift.
 *
 * On the timeout specifically: every assertion that waits on a Server Action uses it rather
 * than Playwright's 5 s default, because add-to-cart mints a cookie and writes two rows, and
 * `placeOrder` runs the whole checkout transaction — each a round trip to eu-west-1. The
 * per-test timeout in `playwright.config.ts` is deliberately well above it; when the two were
 * both 30 s an assertion could never spend its budget and the failure read as a selector bug.
 */
const CHEAP_PRICE = 9.9;

/** €24.90 default variant, above WELCOME10's €20 floor but below FALAS's €30. */
const MID_PRODUCT = '/en/product/on-micronised-creatine';

function uniqueEmail(label: string): string {
  // Playwright gives no per-test random source, and Math.random() would make a failure
  // unreproducible from the report. The worker index plus the label is enough to be unique
  // within a run, and the teardown clears the previous run's rows.
  return `e2e-${label}-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@biocode.test`;
}

/**
 * The COD amount is stated plainly on the success page, and it must be the real total.
 *
 * The amount sits on its own line inside the COD panel rather than embedded in a sentence, so
 * this scopes to the panel — the innermost element that carries the courier sentence — instead
 * of matching the amount anywhere on the page, where the order summary repeats the same figure.
 */
async function expectCodAmount(page: Page, amount: string) {
  const panel = page
    .locator('div')
    .filter({ has: page.getByText('Have it ready in cash for the courier.') })
    .last();
  await expect(panel).toContainText(amount);
}

test.describe('journey 1 — guest buys with cash on delivery', () => {
  test('add to cart, check out, and land on a gated success page', async ({ page }) => {
    const email = uniqueEmail('j1');

    await addCheapItemToCart(page);

    // The badge is the only cart signal in the header, so it has to move.
    await page.goto('/en/cart');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cart');
    await expect(page.getByText(`€${CHEAP_PRICE.toFixed(2)}`).first()).toBeVisible();

    // docs/07 §2 — €30 threshold, so a €9.90 cart is €20.10 short. The nudge renders twice
    // (above the lines on mobile, in the aside on desktop) with exactly one visible per viewport.
    await expect(
      page.getByText('Add €20.10 for free delivery.').filter({ visible: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Continue to payment' }).click();
    await expect(page).toHaveURL(/\/en\/checkout$/);

    // Standard delivery is €2.00 and preselected, so the summary must read €11.90.
    await expect(page.getByText('€11.90').first()).toBeVisible();

    await fillCheckout(page, email);
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    await expect(page).toHaveURL(/\/en\/checkout\/success\/SH-/);

    const orderNumber = (await page.getByText(ORDER_NUMBER).first().textContent())?.trim() ?? '';
    expect(orderNumber).toMatch(ORDER_NUMBER);

    // docs/05 §12 — the COD amount is stated plainly, and it is the real total.
    await expectCodAmount(page, '€11.90');

    // The order summary reflects what was bought, not a generic receipt.
    await expect(page.getByText('NOW-D3-120')).toBeVisible();
    await expect(page.getByText('Rruga B, nr. 12')).toBeVisible();
    await expect(page.getByText('Pending')).toBeVisible();

    // docs/07 §3 — the RPC converted the cart, so the cart is empty again.
    await page.goto('/en/cart');
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('the success page is gated on the access cookie, not the order number', async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail('j1gate');

    await addCheapItemToCart(page);
    await page.goto('/en/checkout');
    await fillCheckout(page, email);
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    const successUrl = page.url();

    /*
     * docs/13 §B1 — order numbers are partly sequential, so the number alone must not open
     * the page. A fresh context has no access cookie and must be bounced to order lookup.
     */
    const stranger = await browser.newContext();
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(successUrl);
    await expect(strangerPage).toHaveURL(/\/order-lookup$/);
    await expect(strangerPage.getByText('Your order is in')).toHaveCount(0);
    await stranger.close();
  });

  test('an empty cart cannot reach checkout', async ({ page }) => {
    await page.goto('/en/checkout');
    // Nothing to buy, so checkout sends you to the cart's empty state rather than
    // rendering a form that could only fail.
    await expect(page).toHaveURL(/\/en\/cart$/);
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });
});

test.describe('journey 3 — a coupon changes the total', () => {
  test('WELCOME10 takes 10% off, and the free-delivery test uses the discounted subtotal', async ({
    page,
  }) => {
    const email = uniqueEmail('j3');

    await page.goto(MID_PRODUCT);
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to your cart.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.goto('/en/checkout');
    // €24.90 + €2.00 standard delivery, before any coupon.
    await expect(page.getByText('€26.90').first()).toBeVisible();

    await fillCheckout(page, email);
    await page.locator('input[name="couponCode"]').fill('WELCOME10');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    /*
     * The arithmetic the RPC must produce, and the reason this test is worth having:
     *   subtotal 2490 · discount 10% = 249 · net 2241
     * 2241 is under the €30 free-delivery threshold, which docs/07 §2 tests against
     * subtotal − discount, so delivery is still charged at €2.00 → €24.41.
     */
    await expect(page.getByText('WELCOME10')).toBeVisible();
    await expect(page.getByText('−€2.49')).toBeVisible();
    await expectCodAmount(page, '€24.41');
  });

  test('an expired coupon is refused and the order is not placed', async ({ page }) => {
    const email = uniqueEmail('j3exp');

    await addCheapItemToCart(page);
    await page.goto('/en/checkout');
    await fillCheckout(page, email);

    // EXPIRED5 is deliberately still `is_active` — the RPC must reject it on its window.
    await page.locator('input[name="couponCode"]').fill('EXPIRED5');
    await page.getByRole('button', { name: 'Place order' }).click();

    // `.first()` — the message renders twice on failure: the role="alert" Alert at the top of
    // the form, and a compact echo beside the submit button so the tap does not look dead.
    await expect(page.getByText("That coupon isn't valid.").first()).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    // Still on checkout, cart intact, nothing charged.
    await expect(page).toHaveURL(/\/en\/checkout$/);
    await expect(page.getByText('€11.90').first()).toBeVisible();
  });

  test('a coupon below its minimum says so instead of silently applying', async ({ page }) => {
    const email = uniqueEmail('j3min');

    // €9.90 is under WELCOME10's €20 floor.
    await addCheapItemToCart(page);
    await page.goto('/en/checkout');
    await fillCheckout(page, email);
    await page.locator('input[name="couponCode"]').fill('welcome10');
    await page.getByRole('button', { name: 'Place order' }).click();

    // Lower-case on purpose: `coupons.code` is citext, so case must not matter.
    // `.first()` for the same Alert-plus-echo reason as the expired-coupon test above.
    await expect(page.getByText('That coupon needs a higher order total.').first()).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  });
});

test.describe('journey 4 — guest order lookup', () => {
  /** Places an order and returns its number, so each lookup test starts from its own order. */
  async function placeOrder(page: Page, email: string): Promise<string> {
    await addCheapItemToCart(page);
    await page.goto('/en/checkout');
    await fillCheckout(page, email);
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    return (await page.getByText(ORDER_NUMBER).first().textContent())?.trim() ?? '';
  }

  async function submitLookup(page: Page, orderNumber: string, email: string) {
    await page.locator('#main input[name="orderNumber"]').fill(orderNumber);
    await page.locator('#main input[name="email"]').fill(email);
    await page.getByRole('button', { name: 'Find my order' }).click();
  }

  test('the right number and email opens the order', async ({ page }) => {
    const email = uniqueEmail('j4');
    const orderNumber = await placeOrder(page, email);

    await page.goto('/en/order-lookup');
    await submitLookup(page, orderNumber, email);

    await expect(page).toHaveURL(new RegExp(`/en/order-lookup/${orderNumber}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(orderNumber);
    await expect(page.getByText('NOW-D3-120')).toBeVisible();
    await expect(page.getByText('€11.90').first()).toBeVisible();

    // docs/08 §4 — a page showing a customer's name, address and phone must never be indexed.
    /*
     * Asserted by **content**, not by position or count.
     *
     * Next streams metadata: under load the layout's default lands early and the page's override
     * arrives later, so the document can carry two robots tags — and which of them is in the
     * head varies with where the streaming boundary fell (docs/13 §N9). What the page promises
     * is that it declares noindex, and that is what this checks.
     */
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).not.toHaveCount(0);
  });

  test('a wrong email on a real order number is refused, generically', async ({ page }) => {
    const email = uniqueEmail('j4wrong');
    const orderNumber = await placeOrder(page, email);

    await page.goto('/en/order-lookup');
    await submitLookup(page, orderNumber, 'someone-else@biocode.test');

    // docs/05 §13 — the same message either way, so this cannot confirm the number exists.
    await expect(page.getByText("We couldn't find an order with those details.")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/order-lookup$/);
  });

  test('an order number that does not exist gets the identical message', async ({ page }) => {
    await page.goto('/en/order-lookup');
    await submitLookup(page, 'SH-2026-999999-ZZZZ', uniqueEmail('j4ghost'));

    await expect(page.getByText("We couldn't find an order with those details.")).toBeVisible();
  });

  test('a failed lookup keeps what was typed', async ({ page }) => {
    const typed = 'SH-2026-999999-ZZZZ';
    const email = uniqueEmail('j4keep');

    await page.goto('/en/order-lookup');
    await submitLookup(page, typed, email);
    await expect(page.getByText("We couldn't find an order with those details.")).toBeVisible();

    /*
     * People come here unsure of a 20-character order number, and the usual failure is one
     * wrong character. Clearing the form would mean retyping both fields to fix it.
     */
    await expect(page.locator('#main input[name="orderNumber"]')).toHaveValue(typed);
    await expect(page.locator('#main input[name="email"]')).toHaveValue(email);
  });

  /*
   * docs/08 §4 lists exactly which paths robots.txt disallows — and `/order-lookup` is not
   * among them, deliberately: the *form* is a public utility page people search for
   * ("track my BIOCODE order"). It is the order **result** that must never be indexed, and
   * that is asserted in the journey above where a real order exists to look at.
   */
  test('robots.txt disallows the money paths in both locales (docs/08 §4)', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    const body = (await response?.text()) ?? '';

    /*
     * Two legitimate shapes, because `SEO_INDEXING` gates crawling entirely (docs/13 §AC).
     *
     * Pre-launch the whole file is `Disallow: /`, which covers every money path more strictly than the
     * per-path lines do. This test asserted only the per-path form and so failed the moment the crawl
     * block went live — reporting a *stronger* robots.txt as a regression. The guarantee being pinned is
     * "these paths are not crawlable", and a blanket disallow satisfies it.
     */
    if (/^\s*Disallow:\s*\/\s*$/m.test(body)) {
      expect(body).not.toContain('Allow: /');
      return;
    }

    for (const path of ['/cart', '/checkout', '/account', '/admin', '/api']) {
      expect(body, `robots.txt must disallow ${path}`).toContain(`Disallow: ${path}`);
    }
    // The en-prefixed routes are separate paths and need their own lines.
    for (const path of ['/en/cart', '/en/checkout', '/en/account']) {
      expect(body, `robots.txt must disallow ${path}`).toContain(`Disallow: ${path}`);
    }
  });
});

test.describe('variant selection', () => {
  test('a non-default variant can actually be bought (docs/05 §3)', async ({ page }) => {
    const email = uniqueEmail('variant');

    // The 240-softgel D3 is €15.90 and is NOT the default — before M4 it was unreachable.
    await page.goto(CHEAP_PRODUCT);

    /*
     * Clicking the label, which is what a user does: the native radio is `sr-only`, so the
     * label is the visible control and carries the focus ring. Asserting through the radio's
     * *state* afterwards keeps the check honest — a label that looks selected but leaves the
     * input unchecked would post the wrong variant.
     */
    await page.getByText('240 softgels', { exact: true }).click();
    await expect(page.getByRole('radio', { name: '240 softgels' })).toBeChecked();
    await expect(page.getByText('€15.90').first()).toBeVisible();

    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to your cart.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.goto('/en/checkout');
    await fillCheckout(page, email);
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('heading', { name: 'Your order is in' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    // €15.90 + €2.00 delivery — and the SKU proves it was the right variant.
    await expect(page.getByText('NOW-D3-240')).toBeVisible();
    await expectCodAmount(page, '€17.90');
  });

  test('double-clicking add to cart adds one item, not two', async ({ page }) => {
    await page.goto(CHEAP_PRODUCT);

    /*
     * docs/05 §12 — `SubmitButton` disables for the whole server round trip, which is what
     * makes a double click harmless. Worth an explicit test because the guard was previously
     * defeated by prop-spread order: the button took `disabled={false}` from its caller,
     * which overrode the pending state, and a fast double click added the item twice.
     */
    const button = page.getByRole('button', { name: 'Add to cart' });
    await button.click();
    await button.click({ force: true, timeout: 1000 }).catch(() => {
      // Expected once the guard works: the button is disabled and the click is refused.
    });

    await expect(page.getByText('Added to your cart.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.goto('/en/cart');
    // The stepper's <output> is labelled "Quantity: N", so this asserts the accessible name
    // a screen reader would read out, not just the digit on screen.
    await expect(page.getByLabel('Quantity: 1')).toHaveText('1');
  });

  test('an out-of-stock variant cannot be selected', async ({ page }) => {
    await page.goto('/en/product/on-gold-standard-whey');
    // docs/11 §7 — the 2.27 kg is the out-of-stock fixture.
    await expect(page.getByRole('radio', { name: /2.27 kg chocolate/ })).toBeDisabled();
    // ...and the default 900 g is still buyable, so the page is not a dead end.
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });
});

test.describe('accessibility', () => {
  test('axe finds no serious or critical violations on the cart', async ({ page }) => {
    await addCheapItemToCart(page);
    await page.goto('/en/cart');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  test('axe finds no serious or critical violations on checkout', async ({ page }) => {
    await addCheapItemToCart(page);
    await page.goto('/en/checkout');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });
});
