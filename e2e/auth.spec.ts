import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * docs/09 §1 journey 2 — sign up → sign in → account.
 *
 * The confirmation email itself is not exercised: the hosted project has confirmations on,
 * and asserting on a real inbox would make the suite depend on mail delivery. Instead the
 * fixture creates an already-confirmed user through the service role — the same state the
 * user reaches after clicking the link — and the journey continues from there. The
 * confirmation flow is covered by the callback route's own error handling.
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

const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await service?.auth.admin.deleteUser(id);
});

/**
 * docs/02 §9 limits sign-in to 5 attempts per 15 minutes **per IP**, and every test here
 * shares localhost — so from the fifth attempt onward the suite starts failing with
 * "too many attempts" instead of what it is asserting. That is the limiter working, but it
 * makes the suite order-dependent and flaky.
 *
 * Giving each test a distinct forwarded address models several different customers signing
 * in, which is what these tests actually represent. It does not weaken the limiter: the
 * per-IP budget is still enforced, and the "too many attempts" path has its own test below.
 *
 * 203.0.113.0/24 is TEST-NET-3, reserved for documentation, so it can never collide with a
 * real client address.
 */
let addressCounter = 0;

/**
 * The limiter is stateful over a 15-minute window, and the addresses below are reused on
 * every run — so without clearing them the suite passes once and then fails on any re-run
 * inside the window, asserting on the previous run's leftovers. The E2E suite owns both
 * TEST-NET ranges outright, so wiping their budgets is safe and makes runs repeatable.
 */
test.beforeAll(async () => {
  if (!service) return;
  for (const range of ['203.0.113.', '198.51.100.']) {
    await service.from('rate_limits').delete().like('key', `%:${range}%`);
  }
});

test.beforeEach(async ({ page }, testInfo) => {
  addressCounter += 1;
  const octet = ((testInfo.workerIndex * 50 + addressCounter) % 250) + 1;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${octet}` });
});

async function confirmedUser() {
  if (!service) throw new Error('Integration credentials missing; cannot run auth E2E.');
  const email = `e2e-${randomUUID()}@shneta.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Arta Krasniqi' },
  });
  if (error || !data.user) throw new Error(`fixture user failed: ${error?.message}`);

  created.push(data.user.id);
  return { email, password };
}

test.describe('auth pages', () => {
  test('sign-in renders in both locales', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await expect(page.getByRole('heading', { name: 'Hyr në llogari' })).toBeVisible();

    await page.goto('/en/auth/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('auth pages are not indexable (docs/08 §4)', async ({ page }) => {
    await page.goto('/en/auth/sign-in');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('wrong credentials give one generic, non-enumerating message', async ({ page }) => {
    await page.goto('/en/auth/sign-in');
    await page.locator('#email').fill('definitely-not-a-user@shneta.test');
    await page.locator('#password').fill('wrong-password-here');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const alert = page.locator('form').getByRole('alert');
    await expect(alert).toBeVisible();
    // Must not distinguish "no such account" from "wrong password".
    await expect(alert).toHaveText("That email or password isn't right.");
  });

  test('sign-up requires the terms checkbox', async ({ page }) => {
    await page.goto('/en/auth/sign-up');
    await page.locator('#fullName').fill('Arta Krasniqi');
    await page.locator('#email').fill(`e2e-${Date.now()}@shneta.test`);
    await page.locator('#password').fill('a-good-passphrase');

    // The native `required` attribute blocks submission before the action is reached.
    await expect(page.locator('input[name="terms"]')).not.toBeChecked();
    await expect(page.locator('input[name="terms"]')).toHaveAttribute('required', '');
  });

  test('repeated failures trip the rate limiter (docs/02 §9)', async ({ page }, testInfo) => {
    /*
     * A fixed address so this test owns its budget — but one per project, because the
     * desktop and mobile runs would otherwise share it and the second would arrive to find
     * it already spent. 198.51.100.0/24 is TEST-NET-2, kept separate from the TEST-NET-3
     * range the per-test addresses use.
     *
     * This block belongs to this test alone. `e2e/checkout.spec.ts` originally took it too
     * and spent 198.51.100.2 before the mobile run got here; the allocation for the whole
     * suite is written out at the top of that file.
     */
    const projectOctet = testInfo.project.name === 'mobile' ? 2 : 1;
    const address = `198.51.100.${projectOctet}`;
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': address });

    /*
     * Clear this address's budget first. The limiter is genuinely stateful over a 15-minute
     * window, so without this the test passes once and then fails on every re-run inside
     * that window — it would be asserting on leftover state from the previous run rather
     * than on the limiter's behaviour.
     */
    await service?.from('rate_limits').delete().eq('key', `signIn:${address}`);

    /*
     * `check_rate_limit` uses a FIXED window, not a sliding one, so attempts that straddle a
     * bucket boundary split (say 3 + 3) and neither bucket reaches the limit of 5. Asserting
     * that exactly the sixth attempt is throttled therefore flakes whenever the test happens
     * to start near a boundary.
     *
     * Running past twice the limit guarantees one bucket exceeds it wherever the boundary
     * falls, so this asserts the property that matters — repeated failures do get shut out —
     * without encoding an assumption about clock alignment.
     */
    const messages: string[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await page.goto('/en/auth/sign-in');
      await page.locator('#email').fill('brute-force@shneta.test');
      await page.locator('#password').fill(`guess-${attempt}`);
      await page.getByRole('button', { name: 'Sign in' }).click();
      messages.push((await page.locator('form').getByRole('alert').textContent()) ?? '');
    }

    // Early attempts get the generic credential error — the limiter must not answer first.
    expect(messages[0]).toContain("isn't right");
    // And the budget does close.
    expect(messages.some((message) => message.includes('Too many attempts'))).toBe(true);
  });

  test('forgot-password never reveals whether an account exists', async ({ page }) => {
    await page.goto('/en/auth/forgot-password');
    await page.locator('#email').fill('nobody-here@shneta.test');
    await page.getByRole('button', { name: 'Send the link' }).click();

    await expect(page.getByText('If an account exists for that address')).toBeVisible();
  });
});

test.describe('account access', () => {
  test('signed-out visitors are redirected away from /account', async ({ page }) => {
    await page.goto('/en/account');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    // The intended destination is preserved for after sign-in.
    expect(page.url()).toContain('next=');
  });

  test('sign in, land on the account, then sign out', async ({ page }) => {
    const user = await confirmedUser();

    await page.goto('/en/auth/sign-in');
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Arta Krasniqi');
    // Loyalty starts at zero and is ledger-derived, not a placeholder.
    await expect(page.getByText('0 points')).toBeVisible();

    // Scoped to the nav: the overview page also links to Settings from its quick links.
    await page
      .getByRole('navigation', { name: 'Account navigation' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(page).toHaveURL(/\/account\/settings$/);
    await expect(page.locator('#email')).toHaveValue(user.email);
    // Email is changed through Supabase's confirm-both-addresses flow, not this form.
    await expect(page.locator('#email')).toBeDisabled();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$|\/en$/);
  });

  test('the sign-in redirect honours ?next= for a same-site path', async ({ page }) => {
    const user = await confirmedUser();

    await page.goto('/en/account/settings');
    await expect(page).toHaveURL(/next=/);

    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/account\/settings$/);
  });
});

test.describe('accessibility', () => {
  for (const path of ['/en/auth/sign-in', '/en/auth/sign-up', '/en/auth/forgot-password']) {
    test(`axe finds no serious or critical violations on ${path}`, async ({ page }) => {
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
