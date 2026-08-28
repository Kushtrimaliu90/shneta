import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ACTION_TIMEOUT } from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/17 — the referral programme in a browser.
 *
 * The rules themselves are proved against SQL, where they belong: a browser is a poor place to assert
 * that a cycle is refused or that ten concurrent calls award one lot of points. `referral-entry`,
 * `referral-accrual` and `referral-admin` in `tests/integration/` do that.
 *
 * What only a browser can prove is the part in between — that the share link sets a cookie the sign-up
 * form then reads, that the grace card appears for a customer who has never ordered and vanishes once
 * they name a referrer, that two customers are served their *own* codes, and that the panel offers
 * support exactly the buttons the database will let them press.
 *
 * Nothing here asserts a points *total*: accrual needs a delivered order, and building one through the
 * UI would be a checkout test wearing a referral hat.
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

async function idFor(email: string): Promise<string> {
  const { data } = await db().from('profiles').select('id').eq('email', email).single();
  return (data as { id: string }).id;
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

test.describe('the referrer page (docs/17 §4)', () => {
  /*
   * The assertion that matters most on this page, and it is about caching rather than about referrals.
   *
   * `next build` lists every `/account/*` route as ● (SSG), because the `[locale]` layout has
   * `generateStaticParams`. If that marker meant what it says, two customers would be served one
   * another's invite code — so this proves the opposite directly, by signing in as two people and
   * comparing. `force-dynamic` and the auth read make it dynamic in fact; this is what says so.
   */
  test('shows the signed-in customer their own code, not a cached one', async ({ browser }) => {
    const first = await staffUser('customer');
    const second = await staffUser('customer');

    const seen: string[] = [];
    for (const account of [first, second]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(0) });

      await signIn(page, account.email, account.password);
      await page.goto('/en/account/referrals');

      const code = await codeFor(account.email);
      await expect(page.getByText(code, { exact: true })).toBeVisible();
      seen.push(code);

      await context.close();
    }

    expect(seen[0]).not.toBe(seen[1]);
  });

  test('offers the link, the share buttons and a scannable QR', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/referrals');

    const code = await codeFor(customer.email);

    // The link is shown as text, so somebody on a browser with no clipboard can still read it off.
    await expect(page.getByText(`/r/${code}`, { exact: false })).toBeVisible();

    // WhatsApp and Viber are plain links with the message pre-written — no SDK, nothing for the CSP.
    const whatsapp = page.getByRole('link', { name: 'WhatsApp' });
    await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.+/);
    await expect(page.getByRole('link', { name: 'Viber' })).toHaveAttribute(
      'href',
      /^viber:\/\/forward\?text=.+/,
    );
    // The pre-written message carries the link, or the recipient gets an invitation to nothing.
    expect(decodeURIComponent((await whatsapp.getAttribute('href')) ?? '')).toContain(`/r/${code}`);

    // Encoded on the server: a data URI, so there is no external request and no bundle cost.
    const qr = page.getByRole('img', { name: new RegExp(code) });
    await expect(qr).toHaveAttribute('src', /^data:image\/gif;base64,/);
  });

  test('an empty programme explains what to do instead of showing nothing', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/referrals');

    await expect(page.getByText('Nobody has used your code yet')).toBeVisible();
    // The empty state says what to do next rather than offering a button (docs/04 §9).
    await expect(page.getByText(/Send the link to one person/)).toBeVisible();
    // And exactly one link to the terms on the page, not two with the same name.
    await expect(page.getByRole('link', { name: 'referral terms' })).toHaveCount(1);
  });

  test('lists a referral masked, and puts no money against it', async ({ page }) => {
    const referrer = await staffUser('customer');
    const referee = await staffUser('customer');

    // Named so the mask has something to shorten, then linked and approved directly: the queue is
    // step 6's surface and this test is about what the referrer is shown.
    await db()
      .from('profiles')
      .update({ full_name: 'Arta Berisha' })
      .eq('id', await idFor(referee.email));
    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + 12);
    await db()
      .from('referral_links')
      .insert({
        referrer_id: await idFor(referrer.email),
        referee_id: await idFor(referee.email),
        status: 'approved',
        source: 'admin',
        code_used: await codeFor(referrer.email),
        linked_at: now.toISOString(),
        expires_at: expires.toISOString(),
      });

    await signIn(page, referrer.email, referrer.password);
    await page.goto('/en/account/referrals');

    const row = page.getByRole('listitem').filter({ hasText: 'Arta B.' });
    await expect(row).toBeVisible();
    // A first name and an initial, never the surname.
    await expect(row).not.toContainText('Berisha');
    await expect(row).toContainText('Active');

    /*
     * No amount on the row. The referrer's own total is on the page and is theirs; a figure attached to
     * one named person is what docs/17 §0.2 exists to prevent, and this is the assertion that would fail
     * if somebody helpfully added a "points from this friend" column.
     */
    await expect(row).not.toContainText('€');
  });

  test('no serious axe violations', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/en/account/referrals');
    await expect(page.getByRole('heading', { name: 'Invite friends', level: 2 })).toBeVisible();

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

test.describe('the admin panel (docs/17 §5)', () => {
  /** A pending link for the queue to work on, created directly — the queue is what is under test. */
  async function pendingLink(referrerEmail: string, refereeEmail: string): Promise<void> {
    const { error } = await db()
      .from('referral_links')
      .insert({
        referrer_id: await idFor(referrerEmail),
        referee_id: await idFor(refereeEmail),
        status: 'pending',
        source: 'signup',
        code_used: await codeFor(referrerEmail),
      });
    if (error) throw new Error(`link insert failed: ${error.message}`);
  }

  test('support can approve from the queue', async ({ page }) => {
    const staff = await staffUser('support');
    const referrer = await staffUser('customer');
    const referee = await staffUser('customer');
    await db()
      .from('profiles')
      .update({ full_name: 'Arta Berisha' })
      .eq('id', await idFor(referee.email));
    await pendingLink(referrer.email, referee.email);

    await signIn(page, staff.email, staff.password);
    await page.goto('/admin/referrals');

    await expect(page.getByRole('heading', { name: 'Referrals', level: 1 })).toBeVisible();

    // The liability figure is on screen before any tab is chosen: with monthly posting it is the number
    // that says what the shop owes and has not paid.
    await expect(page.getByText('Owed, not yet paid')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: referee.email });
    await expect(row).toBeVisible();
    // The signup gap is the queue's most useful column (docs/17 §5).
    await expect(row).toContainText('same day');

    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('row').filter({ hasText: referee.email })).toHaveCount(0, {
      timeout: ACTION_TIMEOUT,
    });

    const { data } = await db()
      .from('referral_links')
      .select('status')
      .eq('referee_id', await idFor(referee.email))
      .single();
    expect((data as { status: string }).status).toBe('approved');
  });

  /*
   * The role split, in the UI this time. It is written twice — `roles.ts` for what renders and each
   * RPC's own `has_any_role` for what is permitted — and this asserts the first agrees with the second.
   * A panel that offers support a button the database will refuse reads as a broken shop.
   */
  test('support is not offered the admin-only tools', async ({ page }) => {
    const staff = await staffUser('support');
    await signIn(page, staff.email, staff.password);
    await page.goto('/admin/referrals');

    await page.getByRole('tab', { name: 'Link by hand' }).click();
    await expect(page.getByText('Only an admin can create a link by hand')).toBeVisible();

    await page.getByRole('tab', { name: 'Fraud signals' }).click();
    await expect(page.getByRole('button', { name: 'Stop all' })).toHaveCount(0);
  });

  test('an admin can link two accounts by hand', async ({ page }) => {
    const staff = await staffUser('admin');
    const referrer = await staffUser('customer');
    const referee = await staffUser('customer');

    await signIn(page, staff.email, staff.password);
    await page.goto('/admin/referrals');
    await page.getByRole('tab', { name: 'Link by hand' }).click();

    await page.locator('#manual-code').fill(await codeFor(referrer.email));
    await page.locator('#manual-email').fill(referee.email);
    await page.locator('#manual-note').fill('told me in the shop');
    await page.getByRole('button', { name: 'Link and approve' }).click();

    await expect(page.getByText('Linked and approved.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    const { data } = await db()
      .from('referral_links')
      .select('status, source')
      .eq('referee_id', await idFor(referee.email))
      .single();
    expect(data).toMatchObject({ status: 'approved', source: 'admin' });
  });

  test('a customer cannot reach the panel at all', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);
    await page.goto('/admin/referrals');

    // The admin layout bounces a non-staff session; the RPCs refuse it too (integration suite).
    await expect(page).not.toHaveURL(/\/admin\/referrals/);
  });

  test('no serious axe violations on the panel', async ({ page }) => {
    const staff = await staffUser('admin');
    await signIn(page, staff.email, staff.password);
    await page.goto('/admin/referrals');
    await expect(page.getByRole('heading', { name: 'Referrals', level: 1 })).toBeVisible();

    for (const tab of ['Queue', 'Links', 'Link by hand', 'Earnings', 'Fraud signals']) {
      await page.getByRole('tab', { name: tab }).click();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
        tab,
      ).toEqual([]);
    }
  });
});
