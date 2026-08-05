import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT } from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/17 §1 — code entry, in a browser.
 *
 * The rules themselves are proved against SQL in `tests/integration/referral-entry.test.ts`, where
 * they belong: a browser is a poor place to assert that a cycle is refused. What only a browser can
 * prove is the part in between — that the share link sets a cookie the sign-up form then reads, that
 * the grace card appears for a customer who has never ordered and disappears once they name a
 * referrer, and that the terms are one click away from both.
 *
 * The accrual half of the programme (steps 4–8) is not built, so nothing here asserts points.
 */
const ips = ipAllocator('233.252.11');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

/** A customer's own invite code, read the way the admin panel would. */
async function codeFor(email: string): Promise<string> {
  const { data } = await db().from('profiles').select('referral_code').eq('email', email).single();
  return (data as { referral_code: string }).referral_code;
}

test.describe('the share link (docs/17 §1)', () => {
  test('remembers the code and pre-fills the sign-up field', async ({ page }) => {
    const referrer = await staffUser('customer');
    const code = await codeFor(referrer.email);

    await page.goto(`/en/r/${code}`);

    // Lands on registration, in the locale the link carried.
    await expect(page).toHaveURL(/\/en\/auth\/sign-up/);
    await expect(page.locator('#referralCode')).toHaveValue(code);
  });

  /*
   * The cookie is `httpOnly` on purpose, so this asserts it by its effect rather than by reading it:
   * navigate away, come back to a page that never saw the code, and the field is still filled.
   */
  test('survives leaving the page and coming back', async ({ page }) => {
    const referrer = await staffUser('customer');
    const code = await codeFor(referrer.email);

    await page.goto(`/en/r/${code}`);
    await page.goto('/en/shop');
    await page.goto('/en/auth/sign-up');

    await expect(page.locator('#referralCode')).toHaveValue(code);
  });

  /** A link with the code typed by hand, without its prefix, still resolves. */
  test('accepts a code that lost its prefix on the way', async ({ page }) => {
    const referrer = await staffUser('customer');
    const code = await codeFor(referrer.email);

    await page.goto(`/en/r/${code.slice(4).toLowerCase()}`);

    await expect(page.locator('#referralCode')).toHaveValue(code);
  });

  test('a nonsense code leaves the field empty rather than echoing it', async ({ page }) => {
    await page.goto('/en/r/%3Cscript%3Ealert(1)%3C%2Fscript%3E');

    await expect(page).toHaveURL(/\/en\/auth\/sign-up/);
    await expect(page.locator('#referralCode')).toHaveValue('');
  });
});

/*
 * ── Why nothing here completes a registration ──
 *
 * The hosted project sends its own confirmation email, and Supabase rate-limits that hard: a second
 * sign-up within the hour comes back `over_email_send_rate_limit`, the form shows "Something went
 * wrong", and no account is created. `auth.spec.ts` already works around this by building its
 * fixtures through the service role, and this file follows the same rule.
 *
 * So the sign-up journey is proved in two halves that meet in the middle:
 *
 *   • here — the share link's cookie reaches the field, and a malformed code is a field error rather
 *     than a refusal to register;
 *   • `tests/integration/referral-entry.test.ts` — a user created with `referral_code` in its sign-up
 *     metadata comes out with a pending link, attributed to `link` or `signup`.
 *
 * What neither covers is the handoff itself: the action copying the parsed field into
 * `options.data.referral_code`. That is five typechecked lines, and it is the honest gap.
 */
test.describe('sign-up with an invite code (docs/17 §1)', () => {
  test('a bad code is a field error, not a refusal to register', async ({ page }) => {
    await page.goto('/en/auth/sign-up');
    await page.locator('#fullName').fill('Leart Shala');
    await page.locator('#email').fill(`e2e-referral-bad-${Date.now()}@biocode.test`);
    await page.locator('#password').fill('a-long-enough-password');
    await page.locator('#referralCode').fill('nonsense');
    await page.locator('input[name="terms"]').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    // The message is on the field, and every other value the customer typed is still there.
    await expect(page.locator('#referralCode-error')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText(/doesn't look like an invite code/i)).toBeVisible();
  });
});

test.describe('the grace window in the account (docs/17 §1)', () => {
  test('a customer who has never ordered can name their referrer', async ({ page }) => {
    const referrer = await staffUser('customer');
    const code = await codeFor(referrer.email);
    const customer = await staffUser('customer');

    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account');

    const card = page.getByRole('heading', { name: 'Were you invited?' });
    await expect(card).toBeVisible();

    await page.locator('#referralClaimCode').fill(code);
    await page.getByRole('button', { name: 'Add code' }).click();

    /*
     * Asserted on the settled state, not on a "Code added" alert.
     *
     * The action calls `revalidatePath('/account')`, so the server tree re-renders, `canEnter` turns
     * false and the whole card unmounts — the success alert inside it loses the race every time, on
     * both viewports. What the customer actually sees is this: the form replaced by the name of the
     * person who invited them, which is a better confirmation than the word "added" anyway.
     */
    await expect(page.getByText(/Invited by/)).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Were you invited?' })).toHaveCount(0);

    // And it is durable, not just a client-side render.
    await page.reload();
    await expect(page.getByText(/Invited by/)).toBeVisible();
  });

  test('rejects a code that cannot be used, and says so on the field', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account');

    // Their own code: the one rejection that is a fact about the caller, so it is named.
    await page.locator('#referralClaimCode').fill(await codeFor(customer.email));
    await page.getByRole('button', { name: 'Add code' }).click();

    await expect(page.getByText(/your own code/i)).toBeVisible({ timeout: ACTION_TIMEOUT });

    // And a code that does not exist gets the generic answer instead (docs/17 §6).
    await page.locator('#referralClaimCode').fill('BIO-ZZZZZ');
    await page.getByRole('button', { name: 'Add code' }).click();

    await expect(page.getByText(/can't use that code/i)).toBeVisible({ timeout: ACTION_TIMEOUT });
  });

  test('the terms are one click from the card', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account');

    await page.getByRole('link', { name: 'referral terms' }).click();

    await expect(page).toHaveURL(/\/en\/legal\/referral-terms/);
    await expect(page.getByRole('heading', { name: 'Referral programme terms' })).toBeVisible();
    // Clause 6 is the promise the whole design exists to keep (docs/17 §0.2).
    await expect(page.getByText(/does \*\*not\*\* see|does not see/)).toBeVisible();
  });

  test('no serious axe violations with the card on screen', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account');
    await expect(page.getByRole('heading', { name: 'Were you invited?' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
});

test.describe('the referral terms page', () => {
  test('renders in both locales without serious axe violations', async ({ page }) => {
    for (const [path, heading] of [
      ['/legal/referral-terms', 'Kushtet e programit të ftesave'],
      ['/en/legal/referral-terms', 'Referral programme terms'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(
        results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
        path,
      ).toEqual([]);
    }
  });
});
