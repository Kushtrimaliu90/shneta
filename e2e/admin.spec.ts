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

/**
 * The service client, narrowed once — non-null assertions are banned (CLAUDE.md §1), and a
 * named throw reports the real problem when the credentials are genuinely absent.
 */
function db(): SupabaseClient {
  if (!service) throw new Error('Service credentials missing; cannot run admin E2E.');
  return service;
}

/** Creates a confirmed user and sets its role through the service client. */
async function staffUser(role: StaffRole): Promise<{ email: string; password: string }> {
  const service = db();

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

    /*
     * docs/06 preamble — **every** admin mutation writes `audit_logs`.
     *
     * This is the one M5 acceptance criterion the integration suite cannot reach: it exercises
     * the database directly, and whether an *action* remembers to call `log_audit` is a property
     * of the application. So it is checked here, after a real operator has clicked through four
     * mutations in a browser.
     *
     * `actor_id` and `actor_role` are stamped by the RPC from `auth.uid()`, never from anything
     * the caller passes — asserting the role proves the audit trail records who acted rather
     * than who claimed to.
     */
    const { data: order } = await db()
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single();

    const { data: auditRows } = await db()
      .from('audit_logs')
      .select('action, actor_role, before, after')
      .eq('entity_type', 'order')
      .eq('entity_id', (order as { id: string }).id);

    const audits = (auditRows ?? []) as {
      action: string;
      actor_role: string;
      before: unknown;
      after: unknown;
    }[];

    // Three status changes plus the shipment — the shipped transition is audited as
    // `order.shipped` by createShipment, not as a bare status change.
    expect(
      audits.filter((row) => row.action === 'order.status_changed'),
      'confirm, process and deliver each write an audit row',
    ).toHaveLength(3);
    expect(
      audits.filter((row) => row.action === 'order.shipped'),
      'shipping writes its own audit row with the tracking details',
    ).toHaveLength(1);

    for (const row of audits) {
      expect(row.actor_role, 'the acting role is recorded, not assumed').toBe('support');
    }

    // And the before/after pair is real, not an empty shell: a status change records what it
    // moved from, which is the whole reason an audit row is worth writing.
    const confirmRow = audits.find(
      (row) =>
        row.action === 'order.status_changed' &&
        (row.before as { status?: string })?.status === 'pending',
    );
    expect(confirmRow, 'the confirm audit row records the previous status').toBeTruthy();
    expect((confirmRow?.after as { status?: string })?.status).toBe('confirmed');
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

test.describe('dashboard (docs/06 §1)', () => {
  test('the confirmation queue is real and can be worked from', async ({ page, browser }) => {
    /*
     * An order is placed first so the queue is guaranteed non-empty, but the assertion is
     * deliberately **not** that this specific order appears in it.
     *
     * The queue holds the ten *oldest* pending orders — that ordering is the point, since the
     * oldest is the customer who has waited longest — and the other specs place pending orders
     * concurrently. Looking for the newest one in a ten-oldest window fails for a reason that
     * has nothing to do with the dashboard, which is what the first version of this test did.
     *
     * What matters here is that the queue is populated and actionable. That a *named* order is
     * findable is asserted in journey 7, through search, where it belongs.
     */
    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.242' });
    await placeGuestOrder(
      shopperPage,
      `e2e-dash-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@shneta.test`,
    );
    await shopper.close();

    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);
    await page.goto('/admin');

    const queue = page.getByRole('region', { name: 'Awaiting confirmation' });
    const firstInQueue = queue.getByRole('link', { name: /SH-\d{4}-\d{6}-[A-Z0-9]{4}/ }).first();
    await expect(firstInQueue).toBeVisible({ timeout: ACTION_TIMEOUT });

    // docs/06 §1 acceptance — the numbers must reconcile with the orders table, so the status
    // list links into the filtered list rather than being a decorative count.
    const statuses = page.getByRole('region', { name: 'Orders by status' });
    await expect(statuses.getByRole('link', { name: 'Pending' })).toBeVisible();

    /*
     * A KPI nobody can click through to is a number an operator has to take on trust; a queue is
     * something they can work. So the test follows the link.
     */
    const queued = (await firstInQueue.textContent())?.trim() ?? '';
    await firstInQueue.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(queued);
    await expect(page.getByText('Pending').first()).toBeVisible();
  });

  test('a warehouse manager sees the queue but no revenue', async ({ page }) => {
    const depo = await staffUser('warehouse_manager');
    await signIn(page, depo.email, depo.password);
    await page.goto('/admin');

    /*
     * docs/01 §3 gives warehouse "orders/ship only". The KPI cards therefore show order counts
     * and the revenue chart is absent entirely — not blanked out, absent, so there is nothing to
     * infer from its shape. Low stock is theirs and must be there.
     */
    await expect(page.getByRole('region', { name: 'Revenue by day' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Awaiting confirmation' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Low stock' })).toBeVisible();
    // docs/11 §7 seeds exactly two low-stock fixtures, so the queue is never empty here.
    await expect(
      page.getByRole('region', { name: 'Low stock' }).getByRole('listitem').first(),
    ).toBeVisible();
  });
});

test.describe('print documents (docs/06 §2)', () => {
  test('an invoice shows money; a packing slip shows a tick box instead', async ({
    page,
    browser,
  }) => {
    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.243' });
    const orderNumber = await placeGuestOrder(
      shopperPage,
      `e2e-print-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@shneta.test`,
    );
    await shopper.close();

    const support = await staffUser('support');
    await signIn(page, support.email, support.password);

    const { data: order } = await db()
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .single();
    const id = (order as { id: string }).id;

    // ── Invoice ───────────────────────────────────────────────────────────────
    await page.goto(`/admin/orders/print?ids=${id}&doc=invoice`);
    await expect(page.getByText('Invoice').first()).toBeVisible();
    await expect(page.getByText(orderNumber).first()).toBeVisible();
    await expect(page.getByText(CHEAP_SKU)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total' })).toBeVisible();
    /*
     * docs/07 §5 — pricing is VAT-inclusive, so the invoice must present VAT as contained in the
     * total, never as a line to be added. An accountant reads this document; "of which VAT" and
     * "VAT" differ by the VAT amount.
     */
    await expect(page.getByText('of which VAT')).toBeVisible();
    await expect(page.getByText(`COLLECT ${CHEAP_ORDER_TOTAL}`)).toBeVisible();

    // ── Packing slip ──────────────────────────────────────────────────────────
    await page.goto(`/admin/orders/print?ids=${id}&doc=packing`);
    await expect(page.getByText('Packing slip').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Picked' })).toBeVisible();

    /*
     * No item prices. A packing slip travels in the box, and someone who bought a gift should not
     * find its price inside — but the COD amount stays, because the courier reads this at the
     * door and has to know what to collect.
     */
    await expect(page.getByRole('columnheader', { name: 'Unit' })).toHaveCount(0);
    await expect(page.getByText('of which VAT')).toHaveCount(0);
    await expect(page.getByText(`COLLECT ${CHEAP_ORDER_TOTAL}`)).toBeVisible();
  });

  test('a role without orders access cannot print one', async ({ page }) => {
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);

    // A real order id is not needed: the capability check runs before anything is read.
    await page.goto('/admin/orders/print?ids=00000000-0000-4000-8000-000000000000&doc=invoice');
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('products list (docs/06 §3)', () => {
  test('a product manager sees the catalogue and its readiness', async ({ page }) => {
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto('/admin/products');

    // docs/11 §7 seeds 24 products, all published.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Products');
    await expect(page.getByRole('link', { name: /Published/ })).toBeVisible();

    // A published row links to the storefront, which is the destination an operator wants
    // from a catalogue list — "show me what the customer sees".
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(page.locator('a[href*="/en/product/"]').first()).toBeVisible();
  });

  test('support cannot reach the catalogue', async ({ page }) => {
    const support = await staffUser('support');
    await signIn(page, support.email, support.password);

    // docs/01 §3 — products belong to the product manager. Support handles orders.
    await page.goto('/admin/products');
    await expect(page).toHaveURL(/\/admin$/);
  });
});

test.describe('product editor (docs/06 §3, docs/07 §10)', () => {
  /** A draft created directly, so the editor test is about editing rather than about creation. */
  async function draftProduct(): Promise<{ id: string; slug: string }> {
    const { data: brand } = await db().from('brands').select('id').limit(1).single();
    const slug = `product-e2e-${randomUUID().slice(0, 8)}`;

    const { data, error } = await db()
      .from('products')
      .insert({
        slug,
        brand_id: (brand as { id: string }).id,
        name: { sq: 'Produkt provë' },
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) throw new Error(`draft fixture failed: ${error.message}`);
    return { id: (data as { id: string }).id, slug };
  }

  test('the checklist names every reason publishing is blocked', async ({ page }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);

    await page.goto(`/admin/products/${draft.id}`);

    /*
     * All four at once. guard_product_publish raises one exception naming one missing thing, so
     * without this an editor discovers the requirements over four round trips.
     */
    for (const blocker of [
      'Add at least one active variant',
      'Add at least one image',
      'Choose a primary category',
      'Needs compliance approval',
    ]) {
      await expect(page.getByText(blocker)).toBeVisible();
    }
  });

  test('a product manager can submit for review but cannot publish', async ({ page }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto(`/admin/products/${draft.id}`);

    // docs/07 §10 — the whole point is that the person writing the claims does not clear them.
    await expect(page.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('In review').first()).toBeVisible({ timeout: ACTION_TIMEOUT });
  });

  test('saving the General tab writes bilingual fields and links a primary category', async ({
    page,
  }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto(`/admin/products/${draft.id}`);

    await page.locator('#name\\.sq').fill('Vitamina Provë');
    await page.locator('#name\\.en').fill('Test Vitamin');
    await page.locator('#description\\.sq').fill('Kontribuon në funksionimin normal.');

    // The first category, marked primary — one of the four publish requirements.
    await page.locator('input[name="categoryIds"]').first().check();
    await page.locator('input[name="primaryCategoryId"]').first().check();

    await page.getByRole('button', { name: 'Save general' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.reload();
    // Persisted, and the primary-category blocker is gone from the checklist.
    await expect(page.locator('#name\\.en')).toHaveValue('Test Vitamin');
    await expect(page.getByText('Choose a primary category')).toHaveCount(0);
  });

  test('a variant can be added, and its price round-trips through cents', async ({ page }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto(`/admin/products/${draft.id}`);

    await page.getByRole('tab', { name: /Variants/ }).click();
    await page.getByRole('button', { name: 'Add a variant' }).click();

    const sku = `E2E-${randomUUID().slice(0, 6).toUpperCase()}`;
    await page.locator('#sku-new').fill(sku);
    await page.locator('#price-new').fill('12.50');
    await page.locator('#name\\.sq').fill('60 kapsula');
    await page.getByRole('button', { name: 'Create variant' }).click();

    await expect(page.getByText('Saved.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    await page.reload();
    await page.getByRole('tab', { name: /Variants/ }).click();
    /*
     * €12.50 stored as 1250 and rendered back as 12.50 — the round trip that money bugs hide
     * in. CLAUDE.md §2: integer cents, never floats.
     */
    await expect(page.getByText(sku)).toBeVisible();
    await expect(page.getByText('€12.50')).toBeVisible();
    await expect(page.getByText('Add at least one active variant')).toHaveCount(0);
  });

  test('the slug is editable on a draft and locked once published', async ({ page }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto(`/admin/products/${draft.id}`);

    // Draft: editable.
    await expect(page.locator('#slug')).not.toHaveAttribute('readonly', '');

    /*
     * Only `published_at` is set, deliberately — the lock keys off "has this ever been live",
     * not off the current status, because archiving a product must not unlock its URL.
     *
     * The first version set `status: 'published'` too and assumed the service role could force
     * it. It cannot: `guard_product_publish` exempts service role from the *approval* check
     * only, and this draft has no variant, so the write was rejected. The failure was invisible
     * because the test ignored the returned error — the same mistake that made the category
     * bug hard to find, one layer up. Hence the assertion below.
     */
    const { error } = await db()
      .from('products')
      .update({ published_at: new Date().toISOString() })
      .eq('id', draft.id);
    expect(error, 'fixture setup must not fail silently').toBeNull();

    await page.reload();
    // CLAUDE.md §10 — a slug is a URL, and changing it breaks every inbound link silently.
    await expect(page.locator('#slug')).toHaveAttribute('readonly', '');
    await expect(page.getByText('locked after publish')).toBeVisible();
  });

  test('compliance sees the claims and the approve control, not the editor', async ({ page }) => {
    const draft = await draftProduct();
    const compliance = await staffUser('compliance_manager');
    await signIn(page, compliance.email, compliance.password);
    await page.goto(`/admin/products/${draft.id}`);

    await expect(page.getByRole('heading', { name: 'Claim-bearing fields' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeVisible();
    // Reading the claims, never rewriting them — that separation is the review.
    await expect(page.getByRole('button', { name: 'Save general' })).toHaveCount(0);
    // And the button is disabled while the product is incomplete, rather than hidden, so it is
    // clear this is the product's fault and not a missing permission.
    await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeDisabled();
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
