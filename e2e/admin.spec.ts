import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * docs/09 §1 journey 7 — admin order operations — plus the shell's role filtering.
 *
 * Staff users are minted per test through the service role rather than signing in as the
 * `@shneta.dev` seed accounts. Three reasons: the suite then works on a database where
 * `pnpm seed:users` has never run; it needs no shared password, so nothing has to be
 * committed or passed through CI; and one test cannot disturb another's account.
 *
 * `@shneta.test` on every address, which is the only pattern `purgeFixtures` deletes.
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
const service: SupabaseClient | null =
  URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

const created: string[] = [];

test.afterAll(async () => {
  // Belt and braces with the global teardown: these are gone either way, but leaving staff
  // accounts lying around between runs is not something to rely on a later step for.
  for (const id of created) await service?.auth.admin.deleteUser(id);
});

/**
 * docs/02 §9 — sign-in is limited to 5 attempts per 15 minutes per IP, and this file signs in
 * once per test. 192.0.2.0/24 belongs to checkout.spec.ts and 198.51.100/203.0.113 to
 * auth.spec.ts, so this file takes the fourth documentation block.
 *
 * 233.252.0.0/24 is MCAST-TEST-NET — reserved, never routable, and therefore just as safe as
 * a TEST-NET block for a value that only ever appears in an `x-forwarded-for` header.
 */
let addressCounter = 0;

test.beforeAll(async () => {
  await service?.from('rate_limits').delete().like('key', '%:233.252.0.%');
});

test.beforeEach(async ({ page }, testInfo) => {
  addressCounter += 1;
  const octet = ((testInfo.workerIndex * 50 + addressCounter) % 250) + 1;
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `233.252.0.${octet}` });
});

type StaffRole =
  | 'support'
  | 'warehouse_manager'
  | 'product_manager'
  | 'content_manager'
  | 'compliance_manager'
  | 'admin'
  | 'customer';

/** Creates a confirmed user and sets its role through the service client. */
async function staffUser(role: StaffRole): Promise<{ email: string; password: string }> {
  if (!service) throw new Error('Service credentials missing; cannot run admin E2E.');

  const email = `e2e-${role}-${randomUUID()}@shneta.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${role}` },
  });
  if (error || !data.user) throw new Error(`fixture staff user failed: ${error?.message}`);
  created.push(data.user.id);

  if (role !== 'customer') {
    // `handle_new_user` defaults to `customer`; the service role is exempt from
    // `prevent_role_escalation` (docs/13 §A4), which is what makes this possible.
    const { error: roleError } = await service
      .from('profiles')
      .update({ role })
      .eq('id', data.user.id);
    if (roleError) throw new Error(`role assignment failed: ${roleError.message}`);
  }

  return { email, password };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/en/auth/sign-in');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The action redirects on success; waiting on the URL leaving /auth is the reliable signal.
  await expect(page).not.toHaveURL(/\/auth\/sign-in/, { timeout: 30_000 });
}

/**
 * Returns the admin nav, opening the drawer first when the viewport needs it.
 *
 * Below `lg` the persistent rail is `hidden` and the nav lives in a drawer behind "Open admin
 * menu". That is not a quirk to work around — it is the mobile design, and a warehouse phone
 * has to reach the same links a desk browser does. So the test does what the operator does.
 *
 * Both renderings carry `aria-label="Admin sections"`, so the drawer's copy is reached through
 * the dialog to keep the two unambiguous rather than relying on document order.
 */
async function adminNav(page: Page) {
  const trigger = page.getByRole('button', { name: 'Open admin menu' });
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Admin menu' })).toBeVisible();
    return page.getByRole('dialog', { name: 'Admin menu' }).getByRole('navigation');
  }
  return page.getByRole('navigation', { name: 'Admin sections' }).first();
}

test.describe('admin shell access', () => {
  test('a signed-out visitor is sent to sign-in with a return path', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/en\/auth\/sign-in\?next=%2Fadmin$/);
  });

  test('a customer cannot reach the admin panel', async ({ page }) => {
    const user = await staffUser('customer');
    await signIn(page, user.email, user.password);

    await page.goto('/admin');

    /*
     * docs/02 §8 — the layout guard sends non-staff to the storefront root rather than a
     * "forbidden" page. A customer who mistypes the URL learns nothing about what is there,
     * and there is nothing for them to do on such a page anyway.
     */
    await expect(page).toHaveURL(/\/(sq)?$|\/$/);
    await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
  });

  test('the panel is never indexable', async ({ page }) => {
    const user = await staffUser('support');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('sidebar shows only what the role may do (docs/01 §3)', () => {
  test('support sees orders, not the catalogue', async ({ page }) => {
    const user = await staffUser('support');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    const nav = await adminNav(page);
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Products' })).toHaveCount(0);
  });

  test('a product manager sees no orders', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    /*
     * docs/01 §3 gives the orders row to support, warehouse and admin only. A product manager
     * reaching an order list would be a permission bug that RLS would then have to catch —
     * the sidebar is the first place it should be impossible.
     */
    const nav = await adminNav(page);
    await expect(nav.getByRole('link', { name: 'Orders' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  });

  test('an admin sees everything that is built', async ({ page }) => {
    const user = await staffUser('admin');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    const nav = await adminNav(page);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Orders' })).toBeVisible();
  });

  test('signing out of the panel lands on the English sign-in page', async ({ page }) => {
    const user = await staffUser('support');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    await page.getByRole('button', { name: 'Sign out' }).click();
    // Not the Albanian one: the admin tree has no locale, so this must not go through
    // next-intl's locale resolution (which is why adminSignOut exists).
    await expect(page).toHaveURL(/\/en\/auth\/sign-in$/, { timeout: 30_000 });
  });
});

test.describe('admin accessibility', () => {
  test('axe finds no serious or critical violations on the dashboard', async ({ page }) => {
    const user = await staffUser('admin');
    await signIn(page, user.email, user.password);
    await page.goto('/admin');

    // docs/09 §1 journey 12 requires one admin page in the a11y smoke.
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });
});
