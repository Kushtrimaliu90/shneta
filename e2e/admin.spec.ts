import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACTION_TIMEOUT,
  CHEAP_ORDER_TOTAL,
  CHEAP_SKU,
  placeGuestOrder,
} from './helpers/storefront';

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

test.describe('journey 7 — support walks an order from placed to delivered', () => {
  test('confirm → ship with tracking → deliver, with the timeline recording each step', async ({
    page,
    browser,
  }) => {
    const customerEmail = `e2e-j7-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@shneta.test`;

    /*
     * The order is placed in its own context, as a guest. Not because the customer and the
     * operator could not share a browser, but because they must not share a *session*: signing
     * in as support in the same context would merge the guest cart into the staff account and
     * the rest of the test would be operating on something no customer ever bought.
     */
    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    // TEST-NET block for this file, so the checkout rate limit stays per-test (see above).
    await shopperPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.240' });
    const orderNumber = await placeGuestOrder(shopperPage, customerEmail);
    await shopper.close();

    const support = await staffUser('support');
    await signIn(page, support.email, support.password);

    // Find it the way an operator would: search, not a URL someone pasted.
    await page.goto('/admin/orders');
    await page.locator('#main input[name="q"]').fill(orderNumber);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('link', { name: orderNumber })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    await page.getByRole('link', { name: orderNumber }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(orderNumber);
    // A fresh COD order is pending and unpaid, and the items are the ones bought.
    await expect(page.getByText('Pending').first()).toBeVisible();
    await expect(page.getByText('Unpaid')).toBeVisible();
    await expect(page.getByText(CHEAP_SKU)).toBeVisible();
    await expect(page.getByText('Guest order')).toBeVisible();
    // docs/06 §2 — COD tells the operator what the courier must collect.
    await expect(page.getByText(`Collect ${CHEAP_ORDER_TOTAL}`)).toBeVisible();

    // ── Confirm ───────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Confirm order' }).click();
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * docs/07 §7.1 — confirmed cannot jump to shipped. The button for the illegal step must be
     * absent rather than present-and-failing, which is the whole point of rendering from
     * `allowedTransitions`.
     */
    await expect(page.getByRole('button', { name: 'Mark shipped…' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start preparing' }).click();
    await expect(page.getByText('Being prepared').first()).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // ── Ship, with tracking ───────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Mark shipped…' }).click();
    await page.locator('#carrier').fill('Posta e Kosovës');
    await page.locator('#trackingNumber').fill('XK123456789');
    await page.getByRole('button', { name: 'Save and mark shipped' }).click();

    await expect(page.getByText('Shipped').first()).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText('Posta e Kosovës')).toBeVisible();
    await expect(page.getByText('XK123456789')).toBeVisible();

    // ── Deliver ───────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * docs/07 §7.2 — delivery settles a COD payment. This is the assertion that proves the
     * trigger ran, not just that a status column changed.
     */
    await expect(page.getByText('Paid')).toBeVisible();

    // The timeline recorded every step (docs/06 §2).
    const timeline = page.getByRole('region', { name: 'Timeline' });
    for (const step of [
      'pending → confirmed',
      'confirmed → processing',
      'processing → shipped',
      'shipped → delivered',
    ]) {
      await expect(timeline.getByText(step)).toBeVisible();
    }
  });

  test('an internal note is marked internal and never shown to the customer', async ({
    page,
    browser,
  }) => {
    const customerEmail = `e2e-j7note-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@shneta.test`;

    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.241' });
    const orderNumber = await placeGuestOrder(shopperPage, customerEmail);

    const support = await staffUser('support');
    await signIn(page, support.email, support.password);
    await page.goto('/admin/orders');
    await page.locator('#main input[name="q"]').fill(orderNumber);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('link', { name: orderNumber }).click();

    const secret = 'Customer called — do not show this to them.';
    await page.locator('#note-message').fill(secret);
    await page.getByRole('button', { name: 'Add note' }).click();

    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(timeline.getByText(secret)).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(timeline.getByText('Internal').first()).toBeVisible();

    /*
     * And the customer cannot read it. The shopper still holds the access cookie for this
     * order, so their own view of it is reachable — and `p_read on order_events` filters
     * non-visible rows in the database, not in a query somebody has to remember to write.
     */
    await shopperPage.goto(`/en/order-lookup/${orderNumber}`);
    await expect(shopperPage.getByText(secret)).toHaveCount(0);
    await shopper.close();
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
