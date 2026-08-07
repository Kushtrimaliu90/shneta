import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  ACTION_TIMEOUT,
  CHEAP_ORDER_TOTAL,
  CHEAP_SKU,
  placeGuestOrder,
} from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/09 §1 journey 7 — admin order operations — plus the shell's role filtering.
 *
 * Staff users are minted per test through the service role rather than signing in as the
 * `@biocode.dev` seed accounts. Three reasons: the suite then works on a database where
 * `pnpm seed:users` has never run; it needs no shared password, so nothing has to be
 * committed or passed through CI; and one test cannot disturb another's account.
 *
 * `@biocode.test` on every address, which is the only pattern `purgeFixtures` deletes.
 */

const ips = ipAllocator('233.252.0');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

/**
 * Returns the admin nav, opening the drawer first when the viewport needs it.
 *
 * Below `lg` the persistent rail is hidden and the nav lives in a drawer behind "Open admin
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
    const customerEmail = `e2e-j7-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@biocode.test`;

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
    const customerEmail = `e2e-j7note-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@biocode.test`;

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
      `e2e-dash-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@biocode.test`,
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
      `e2e-print-w${process.env.TEST_PARALLEL_INDEX ?? '0'}@biocode.test`,
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

  test('an image can be uploaded, and it clears the last publish blocker', async ({ page }) => {
    const draft = await draftProduct();
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto(`/admin/products/${draft.id}`);

    await expect(page.getByText('Add at least one image')).toBeVisible();

    await page.getByRole('tab', { name: /Media/ }).click();

    /*
     * A real 1×1 PNG, not a stub. The bucket enforces its own MIME allowlist server-side, so a
     * fake `image/png` with text bytes would be rejected by storage and the test would prove
     * nothing about the path that matters.
     */
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    await page.setInputFiles('#image-upload', {
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: png,
    });

    // The upload is three hops — sign, PUT to storage, record the row — then a reload.
    await expect(page.getByRole('tab', { name: /Media \(1\)/ })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // And the blocker is gone from the checklist, which is the point of the whole tab.
    await expect(page.getByText('Add at least one image')).toHaveCount(0);

    /*
     * The object really is in the bucket under this product's prefix — `attachProductImage`
     * refuses any path outside it, and a row pointing at nothing would render a broken image
     * on a live product page.
     */
    const { data: rows } = await db()
      .from('product_images')
      .select('storage_path')
      .eq('product_id', draft.id);

    const paths = (rows ?? []) as { storage_path: string }[];
    expect(paths).toHaveLength(1);
    expect(paths[0]?.storage_path.startsWith(`${draft.id}/`)).toBe(true);

    const { data: listed } = await db().storage.from('product-images').list(draft.id);
    expect(listed ?? [], 'the bytes are in the bucket, not just the row').toHaveLength(1);
  });

  test('a rejected create marks the bad field and keeps what was typed', async ({ page }) => {
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);
    await page.goto('/admin/products');

    await page.getByRole('button', { name: 'New product' }).click();

    /*
     * An uppercase slug with spaces — the shape a person actually types when they treat the
     * field as a title. It passes the browser's `required` check and fails `slugSchema`, which
     * is exactly the path that produced "Check the fields marked below" with nothing marked and
     * an emptied form.
     */
    await page.locator('#new-slug').fill('Vitamin D3 Forte');
    await page.locator('#new-brand').selectOption({ index: 1 });
    await page.locator('#new-name').fill('Vitaminë D3 Forte');
    await page.getByRole('button', { name: 'Create draft' }).click();

    // The offending field says what is wrong, in words an operator can act on.
    await expect(page.locator('#new-slug-error')).toContainText('Lowercase letters', {
      timeout: ACTION_TIMEOUT,
    });
    await expect(page.locator('#new-slug')).toHaveAttribute('aria-invalid', 'true');

    // And nothing was thrown away — including the two fields that were perfectly fine.
    await expect(page.locator('#new-slug')).toHaveValue('Vitamin D3 Forte');
    await expect(page.locator('#new-name')).toHaveValue('Vitaminë D3 Forte');
    await expect(page.locator('#new-brand')).not.toHaveValue('');

    // Correcting only the slug is enough to get through.
    await page.locator('#new-slug').fill(`product-fix-${randomUUID().slice(0, 8)}`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: ACTION_TIMEOUT });
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

test.describe('journey 8 — a product goes from nothing to the storefront', () => {
  test('create → fill → approve → live, and the storefront reflects it', async ({
    page,
    browser,
  }) => {
    const slug = `product-j8-${randomUUID().slice(0, 8)}`;
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);

    /*
     * docs/09 §1 journey 8. This is the one test that exercises the whole catalogue loop
     * end to end, and specifically the part nothing else touches: that publishing purges the
     * cache tags, so the storefront serves the new product rather than a cached listing that
     * predates it. Every other M6 test stops at the database.
     */

    // ── 1 · Create ────────────────────────────────────────────────────────────
    await page.goto('/admin/products');
    await page.getByRole('button', { name: 'New product' }).click();
    await page.locator('#new-slug').fill(slug);
    await page.locator('#new-brand').selectOption({ index: 1 });
    await page.locator('#new-name').fill('Produkt i Ri');
    await page.getByRole('button', { name: 'Create draft' }).click();

    // The action redirects into the editor, which is where the work continues.
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/, { timeout: ACTION_TIMEOUT });
    const productId = page.url().split('/').pop() ?? '';

    // ── 2 · General: name, description, primary category ──────────────────────
    await page.locator('#name\\.en').fill('New Product');
    await page.locator('#description\\.sq').fill('Kontribuon në funksionimin normal të trupit.');
    await page.locator('input[name="categoryIds"]').first().check();
    await page.locator('input[name="primaryCategoryId"]').first().check();
    await page.getByRole('button', { name: 'Save general' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    // ── 3 · A variant ─────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: /Variants/ }).click();
    await page.getByRole('button', { name: 'Add a variant' }).click();
    const sku = `J8-${randomUUID().slice(0, 6).toUpperCase()}`;
    await page.locator('#sku-new').fill(sku);
    await page.locator('#price-new').fill('19.90');
    await page.locator('#name\\.sq').fill('30 kapsula');
    await page.getByRole('button', { name: 'Create variant' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: ACTION_TIMEOUT });

    // ── 4 · An image ──────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: /Media/ }).click();
    await page.setInputFiles('#image-upload', {
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByRole('tab', { name: /Media \(1\)/ })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // Everything except approval is now in place — the checklist should say exactly that.
    await expect(page.getByText('Needs compliance approval')).toBeVisible();
    await expect(page.getByText('Add at least one variant')).toHaveCount(0);
    await expect(page.getByText('Add at least one image')).toHaveCount(0);
    await expect(page.getByText('Choose a primary category')).toHaveCount(0);

    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('In review').first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * It must NOT be on the storefront yet — proved through the **listing**, not by requesting
     * the product URL.
     *
     * Requesting it would fill Next's full-route cache with a 404 for that exact path, and that
     * negative entry survives the tag purge on publish (see docs/13 §K2). The test would then be
     * measuring a caching artefact it created itself rather than the publish flow. Asserting the
     * product is absent from the shop is the same claim without the side effect.
     */
    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.goto('/en/shop?q=Produkt+i+Ri');
    await expect(
      shopperPage.getByText('New Product'),
      'an unapproved product must not be listed',
    ).toHaveCount(0);

    // ── 5 · Compliance approves ───────────────────────────────────────────────
    const compliancePage = await (await browser.newContext()).newPage();
    await compliancePage.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.0.244' });
    const compliance = await staffUser('compliance_manager');
    await signIn(compliancePage, compliance.email, compliance.password);
    await compliancePage.goto(`/admin/products/${productId}`);

    await expect(
      compliancePage.getByRole('heading', { name: 'Claim-bearing fields' }),
    ).toBeVisible();
    // The Albanian claim is shown; English is marked untranslated rather than echoing the sq
    // text back, which would tell compliance a translation exists when it does not.
    await expect(compliancePage.getByText('Kontribuon në funksionimin normal')).toBeVisible();
    await expect(compliancePage.getByText('not translated').first()).toBeVisible();

    const approve = compliancePage.getByRole('button', { name: 'Approve and publish' });
    await expect(approve, 'everything is in place, so approval is not blocked').toBeEnabled();
    await approve.click();
    await expect(compliancePage.getByText('Published', { exact: true })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // ── 6 · It is live ────────────────────────────────────────────────────────
    /*
     * docs/06 §3 acceptance — "storefront reflects edits instantly via tag purge". The PDP is
     * ISR, so without `revalidatePublic` on the approve action this request would be served
     * from a cache generated before the product existed. That is the assertion.
     */
    /*
     * The database first, then the page. If these ever disagree the difference tells you which
     * half is wrong in one run instead of two — and this test has already cost one round of
     * "is it the data or the cache?" that a direct assertion would have answered immediately.
     */
    const { data: saved } = await db()
      .from('products')
      .select('slug, status, approved_by')
      .eq('id', productId)
      .single();

    const row = saved as { slug: string; status: string; approved_by: string | null };
    expect(row.status, 'approval must have published it').toBe('published');
    expect(row.approved_by, 'and stamped the approver').not.toBeNull();
    expect(row.slug, 'and it is the slug the storefront will be asked for').toBe(slug);

    const afterApproval = await shopperPage.goto(`/en/product/${slug}`);
    expect(afterApproval?.status(), 'approval must purge the tags and make it reachable').toBe(200);
    await expect(shopperPage.getByRole('heading', { level: 1 })).toHaveText('New Product');
    await expect(shopperPage.getByText('€19.90').first()).toBeVisible();

    /*
     * Live, and correctly **not purchasable** — because nothing has stocked it.
     *
     * This is not a gap in the publish flow; it is where M6 ends. Receiving stock is
     * `/admin/inventory`, which is M10, so a product manager can today take a product all the
     * way to live and still cannot make it buyable. Everything downstream behaves properly:
     * `v_product_stock` reports out_of_stock for a variant with no inventory row, the BuyBox
     * disables the button and labels it, and checkout would refuse it.
     *
     * Asserting the out-of-stock state rather than skipping it keeps the boundary visible — the
     * day inventory lands, this assertion is what should change.
     */
    await expect(
      shopperPage.getByRole('button', { name: 'Currently out of stock' }),
    ).toBeDisabled();

    await shopper.close();
    await compliancePage.context().close();
  });
});

test.describe('taxonomy admin (docs/06 §4–§7)', () => {
  /**
   * The four screens share one component, so they are tested as one thing with the differences
   * asserted per kind. Testing each in full would be four copies of the same click sequence
   * proving the same code path four times.
   */
  const KINDS = [
    { path: '/admin/brands', role: 'product_manager', prefix: 'brand', singular: 'brand' },
    {
      path: '/admin/categories',
      role: 'product_manager',
      prefix: 'category',
      singular: 'category',
    },
    { path: '/admin/goals', role: 'content_manager', prefix: 'goal', singular: 'health goal' },
    {
      path: '/admin/ingredients',
      role: 'product_manager',
      prefix: 'ingredient',
      singular: 'ingredient',
    },
  ] as const;

  const TABLES = {
    brand: 'brands',
    category: 'categories',
    goal: 'health_goals',
    ingredient: 'ingredients',
  } as const;

  /**
   * Waits for a taxonomy row to reach the expected name **in the database**.
   *
   * The signal a Server Action has finished has to come from the database, not the screen.
   *
   * The first version of these tests waited on `getByRole('cell', { name: 'After Rename' })`,
   * which passed the instant the operator's own keystrokes landed: the editor is a `<td>`, and
   * the accessible name of a cell includes the *values of the inputs inside it*. So the wait
   * returned before the action had been dispatched, the next line read the old row, and the
   * failure surfaced three steps later as an apparently stale storefront — which cost an hour
   * inside the cache layer for a defect that was never there.
   *
   * Same lesson as docs/13 §K2, in a new disguise: **an assertion that can be satisfied by what
   * the test itself typed is not an assertion.**
   */
  async function expectRowName(
    kind: keyof typeof TABLES,
    slug: string,
    expected: string,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from(TABLES[kind])
            .select('name')
            .eq('slug', slug)
            .maybeSingle();
          if (!data) return null;
          const name = (data as { name: unknown }).name;
          // Brands store a plain-text trademark; the other three store bilingual jsonb.
          return typeof name === 'string' ? name : ((name as { sq?: string })?.sq ?? null);
        },
        { message: `${TABLES[kind]}.${slug} never reached "${expected}"`, timeout: ACTION_TIMEOUT },
      )
      .toBe(expected);
  }

  for (const kind of KINDS) {
    test(`a ${kind.singular} can be created and edited from ${kind.path}`, async ({ page }) => {
      const user = await staffUser(kind.role);
      await signIn(page, user.email, user.password);

      const slug = `${kind.prefix}-e2e-${randomUUID().slice(0, 8)}`;
      await page.goto(kind.path);

      await page.getByRole('button', { name: `New ${kind.singular}` }).click();
      await page.locator('#slug-new').fill(slug);
      await page.locator('#nameSq-new').fill('Emri Provë');
      await page.getByRole('button', { name: `Create ${kind.singular}` }).click();

      // The write, confirmed where it counts, before anything about the screen is believed.
      await expectRowName(kind.prefix, slug, 'Emri Provë');

      const { data: created } = await db()
        .from(TABLES[kind.prefix])
        .select('is_active')
        .eq('slug', slug)
        .single();
      expect(
        (created as { is_active: boolean }).is_active,
        'a new entry is visible to customers by default',
      ).toBe(true);

      // And then the list, which is what tells the operator it worked.
      await expect(page.getByRole('table').getByText(slug, { exact: true })).toBeVisible({
        timeout: ACTION_TIMEOUT,
      });
    });
  }

  test('a slug that is already taken is refused, and what was typed survives', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);

    const slug = `brand-dupe-${randomUUID().slice(0, 8)}`;
    const { error } = await db().from('brands').insert({ slug, name: 'Occupant' });
    expect(error, 'fixture brand must insert').toBeNull();

    await page.goto('/admin/brands');
    await page.getByRole('button', { name: 'New brand' }).click();
    await page.locator('#slug-new').fill(slug);
    await page.locator('#nameSq-new').fill('Emri i Dytë');
    await page.getByRole('button', { name: 'Create brand' }).click();

    await expect(page.getByText('Another entry already uses that slug.')).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
    // The bug this repeats from the product create form: a rejection that empties the form.
    await expect(page.locator('#nameSq-new')).toHaveValue('Emri i Dytë');
  });

  test('an invalid slug marks the field and says what to change', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);

    await page.goto('/admin/brands');
    await page.getByRole('button', { name: 'New brand' }).click();
    await page.locator('#slug-new').fill('Not A Slug');
    await page.locator('#nameSq-new').fill('Emri');
    await page.getByRole('button', { name: 'Create brand' }).click();

    await expect(page.locator('#slug-new')).toHaveAttribute('aria-invalid', 'true', {
      timeout: ACTION_TIMEOUT,
    });
    await expect(page.locator('#slug-new-error')).toContainText('Lowercase letters');
  });

  test('a category with a published product cannot be hidden', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);

    /*
     * docs/06 §4. Built through the service role rather than the UI: getting a product to
     * `published` needs a variant, an image, a primary category and an approval, and this test
     * is about the guard, not about the publish flow — journey 8 covers that.
     */
    const categorySlug = `category-inuse-${randomUUID().slice(0, 8)}`;
    const { data: category } = await db()
      .from('categories')
      .insert({ slug: categorySlug, name: { sq: 'Kategori e Zënë' } })
      .select('id')
      .single();

    const { data: brand } = await db().from('brands').select('id').limit(1).single();
    const { data: product } = await db()
      .from('products')
      .insert({
        slug: `product-inuse-${randomUUID().slice(0, 8)}`,
        brand_id: (brand as { id: string }).id,
        name: { sq: 'Produkt i Publikuar' },
        // Straight to published: the service role is exempt from the approval check only
        // (migration 14), so the other three conditions still have to be met — except that the
        // trigger fires on the *transition*, and inserting as published skips it.
        status: 'published',
      })
      .select('id')
      .single();

    const { error: linkError } = await db()
      .from('product_categories')
      .insert({
        product_id: (product as { id: string }).id,
        category_id: (category as { id: string }).id,
        is_primary: true,
      });
    expect(linkError, 'fixture link must insert').toBeNull();

    await page.goto('/admin/categories');
    await page
      .getByRole('row')
      .filter({ hasText: categorySlug })
      .getByRole('button', { name: 'Edit' })
      .click();

    await page.getByRole('button', { name: 'Hide from the storefront' }).click();

    await expect(page.getByText('Published products still use this')).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    const { data: after } = await db()
      .from('categories')
      .select('is_active')
      .eq('id', (category as { id: string }).id)
      .single();
    expect((after as { is_active: boolean }).is_active, 'and it really is still active').toBe(true);
  });

  test('a category cannot be made its own ancestor', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);

    const parentSlug = `category-parent-${randomUUID().slice(0, 8)}`;
    const childSlug = `category-child-${randomUUID().slice(0, 8)}`;

    const { data: parent } = await db()
      .from('categories')
      .insert({ slug: parentSlug, name: { sq: 'Prindi' } })
      .select('id')
      .single();
    const { data: child } = await db()
      .from('categories')
      .insert({
        slug: childSlug,
        name: { sq: 'Fëmija' },
        parent_id: (parent as { id: string }).id,
      })
      .select('id')
      .single();

    await page.goto('/admin/categories');
    await page
      .getByRole('row')
      .filter({ hasText: parentSlug })
      .getByRole('button', { name: 'Edit' })
      .click();

    // Put the parent inside its own child — the loop that would silently drop both from the menu.
    const parentId = (parent as { id: string }).id;
    await page.locator(`#parentId-${parentId}`).selectOption((child as { id: string }).id);
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(page.getByText('cannot sit inside itself')).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    const { data: after } = await db()
      .from('categories')
      .select('parent_id')
      .eq('id', parentId)
      .single();
    expect((after as { parent_id: string | null }).parent_id, 'the parent is untouched').toBeNull();
  });

  test('a content manager reaches goals but not brands', async ({ page }) => {
    const user = await staffUser('content_manager');
    await signIn(page, user.email, user.password);

    await page.goto('/admin/goals');
    await expect(page.getByRole('heading', { name: 'Health goals', level: 1 })).toBeVisible();

    // docs/01 §3 gives the catalogue rows to the product manager. Redirected, not shown a 403.
    await page.goto('/admin/brands');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('an edit to a brand reaches the storefront immediately', async ({ page, browser }) => {
    /*
     * The tag-purge assertion for taxonomy, and the reason this test exists at all.
     *
     * `readBrands` was `cache()`-only until docs/13 §K1, so `revalidatePublic([brands])` from
     * the admin purged a tag nothing carried and a renamed brand stayed stale for the whole
     * revalidate window. Journey 8 caught it for products; nothing covered the other seven reads.
     */
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);

    const slug = `brand-live-${randomUUID().slice(0, 8)}`;
    const { data: brand } = await db()
      .from('brands')
      .insert({ slug, name: 'Before Rename', is_active: true })
      .select('id')
      .single();
    const brandId = (brand as { id: string }).id;

    const shopper = await browser.newContext();
    const shopperPage = await shopper.newPage();
    await shopperPage.goto(`/en/brands/${slug}`);
    await expect(shopperPage.getByRole('heading', { level: 1 })).toContainText('Before Rename');

    await page.goto('/admin/brands');
    await page
      .getByRole('row')
      .filter({ hasText: slug })
      .getByRole('button', { name: 'Edit' })
      .click();
    await page.locator(`#nameSq-${brandId}`).fill('After Rename');
    await page.getByRole('button', { name: 'Save' }).first().click();

    /*
     * Wait for the write, not for the form. Only once the row has actually changed is a stale
     * storefront evidence of anything — before that it is just a request still in flight. See
     * `expectRowName` above for the hour this cost.
     */
    await expectRowName('brand', slug, 'After Rename');

    /*
     * Reload until it changes, rather than reloading once.
     *
     * A single reload failed roughly one run in three, and the reason is not a slow write — the write is
     * already confirmed by `expectRowName` above. It is ISR's stale-while-revalidate: `revalidateTag`
     * marks the cached entry stale, and the **first** request after that may still be served the stale
     * copy while regeneration happens behind it. The second request gets the new one.
     *
     * So the assertion this test is named for — "reaches the storefront immediately" — is about the purge
     * happening at all, not about the very first byte after it. Polling keeps that claim and drops the
     * one it never meant to make. Without this it is a flake that fails a whole suite run for a reason
     * unrelated to whatever was being changed.
     */
    await expect
      .poll(
        async () => {
          await shopperPage.reload();
          return (await shopperPage.getByRole('heading', { level: 1 }).textContent()) ?? '';
        },
        { timeout: ACTION_TIMEOUT, intervals: [250, 500, 1000, 2000] },
      )
      .toContain('After Rename');

    await shopper.close();
  });
});

test.describe('compliance queue (docs/06 §14)', () => {
  /**
   * A product submitted for review, with claims to read.
   *
   * The English name carries the run's random suffix, and every locator below filters on it.
   *
   * That is not decoration. The queue is a **shared list**: two tests in this file, plus the
   * desktop and mobile projects running concurrently, all put products into it. The first
   * version named them all "Product In Review" and filtered by that — a strict-mode violation
   * the moment a second one existed, and an assertion that could have acted on another test's
   * fixture if it had not. Anything asserted against a queue has to be identified uniquely.
   */
  async function submittedProduct(): Promise<{ id: string; slug: string; name: string }> {
    const { data: brand } = await db().from('brands').select('id').limit(1).single();
    const suffix = randomUUID().slice(0, 8);
    const slug = `product-queue-${suffix}`;
    const name = `Review Fixture ${suffix}`;

    const { data, error } = await db()
      .from('products')
      .insert({
        slug,
        brand_id: (brand as { id: string }).id,
        name: { sq: `Produkt në Pritje ${suffix}`, en: name },
        description: { sq: 'Kontribuon në imunitet.' },
        warnings: { sq: 'Mos e tejkaloni dozën.' },
        status: 'pending_review',
      })
      .select('id')
      .single();

    if (error) throw new Error(`queue fixture failed: ${error.message}`);
    return { id: (data as { id: string }).id, slug, name };
  }

  test('the queue shows both languages and marks what is untranslated', async ({ page }) => {
    const item = await submittedProduct();
    const reviewer = await staffUser('compliance_manager');
    await signIn(page, reviewer.email, reviewer.password);

    await page.goto('/admin/compliance');

    const card = page.getByRole('listitem').filter({ hasText: item.name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Kontribuon në imunitet.');

    /*
     * The point of the whole screen. `pickLocale` falls back to Albanian when English is absent,
     * which would render the same paragraph twice and imply a translation had been reviewed —
     * the exact defect corrected on the product page's read-only view.
     */
    await expect(card.getByText('not translated').first()).toBeVisible();
  });

  test('a product manager cannot reach the queue', async ({ page }) => {
    const pm = await staffUser('product_manager');
    await signIn(page, pm.email, pm.password);

    await page.goto('/admin/compliance');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('rejecting from the queue returns it to draft and records the note', async ({ page }) => {
    const item = await submittedProduct();
    const reviewer = await staffUser('compliance_manager');
    await signIn(page, reviewer.email, reviewer.password);

    await page.goto('/admin/compliance');
    const card = page.getByRole('listitem').filter({ hasText: item.name });

    await card.getByRole('button', { name: 'Reject…' }).click();
    await card.getByRole('textbox').fill('The description claims it prevents colds.');
    await card.getByRole('button', { name: 'Reject and return to draft' }).click();

    /*
     * This card leaves the queue — not "the queue is empty". Other tests and the other viewport
     * project have their own fixtures waiting, and an assertion about the whole list would be
     * about them as much as about this rejection.
     */
    await expect(card).toHaveCount(0, { timeout: ACTION_TIMEOUT });

    const { data: after } = await db().from('products').select('status').eq('id', item.id).single();
    expect((after as { status: string }).status).toBe('draft');

    /*
     * docs/06 §14 — the note is the whole value of a rejection, and it lives in the audit log.
     *
     * `before` / `after`, not `changes`: `log_audit` writes the two-column shape. Asking for a
     * column that does not exist makes PostgREST return an **error with a null body**, which
     * `.data ?? []` then turns into a confident "no audit rows were written" — a failure that
     * accuses the code under test of the tester's typo. Hence the explicit error assertion.
     */
    const { data: auditRows, error: auditError } = await db()
      .from('audit_logs')
      .select('action, after')
      .eq('entity_id', item.id)
      .eq('action', 'product.rejected')
      .limit(1);

    expect(auditError, 'the audit query itself must succeed').toBeNull();
    expect((auditRows ?? []).length, 'a rejection must be audited').toBe(1);
    expect(JSON.stringify(auditRows?.[0]?.after)).toContain('prevents colds');
  });
});

/**
 * The search console (docs/06) — the panel that makes ranking improvable rather than tuned once.
 *
 * **Read path only, deliberately.** Saving a synonym group fires a statement trigger that re-indexes the
 * entire catalogue, so a write left behind by a test would quietly change the results every later
 * assertion in this suite depends on. The write path is covered by unit tests over the schemas, where it
 * costs nothing global.
 */
test.describe('search console (docs/06)', () => {
  test('reports queries and lists the seeded synonyms and redirects', async ({ page }) => {
    const user = await staffUser('product_manager');
    await signIn(page, user.email, user.password);
    await page.goto('/admin/search');

    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Query report' })).toBeVisible();

    await page.getByRole('tab', { name: 'Redirects' }).click();
    // Seeded in migration 69, so this doubles as the assertion that they survived deployment.
    await expect(page.getByText('/legal/shipping-returns').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Synonyms' }).click();
    await expect(page.getByText('magnez, magnesium', { exact: false }).first()).toBeVisible();
  });

  test('support may read the report but not change anything', async ({ page }) => {
    const user = await staffUser('support');
    await signIn(page, user.email, user.password);
    await page.goto('/admin/search');

    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    await page.getByRole('tab', { name: 'Synonyms' }).click();
    // The capability split: reading the report is a customer question support hears first; changing
    // what search does is catalogue work.
    await expect(page.getByRole('button', { name: 'Save group' })).toBeDisabled();
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
