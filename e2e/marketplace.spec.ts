import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createdUsers, db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/16 §5 — the merchant portal, the offer lifecycle, and who the customer is buying from.
 *
 * These journeys exist because nothing else can see them. The integration suite proves the database
 * refuses what it should; a portal that returns a 500 from a server component, or a nav that never
 * unlocks, or a seller line that renders `{merchant}` instead of a name, would pass every one of
 * those tests and be broken for every merchant.
 *
 * The offer is driven **through the screens**, not through the tables: create it on the form, submit
 * it for review, approve it as a product manager, and then check the merchant's own portal says it is
 * in the buy box. That last assertion is the one worth having — it is computed from
 * `variant_buy_box`, the same function the storefront reads, so a portal that agreed with itself but
 * not with the shop would fail here.
 */

const ips = ipAllocator('233.252.9');

/** Fixture merchants and products, removed in `afterAll` and by the global teardown either way. */
const merchantIds: string[] = [];
const productIds: string[] = [];
const brandIds: string[] = [];

test.beforeAll(async () => {
  await ips.reset();
});

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.afterAll(async () => {
  const service = db();
  for (const id of merchantIds) {
    await service.from('merchant_offers').delete().eq('merchant_id', id);
    await service.from('merchants').delete().eq('id', id);
  }
  for (const id of productIds) {
    await service.from('product_variants').delete().eq('product_id', id);
    await service.from('products').delete().eq('id', id);
  }
  for (const id of brandIds) await service.from('brands').delete().eq('id', id);
  await deleteCreatedUsers();
});

/**
 * A merchant with a portal account, at whatever status the test needs.
 *
 * The email is `…@biocode.test` on both the auth user and the merchant row, which is what the purge
 * matches — a fixture merchant that survived a failed run would otherwise sit in the applications
 * queue looking like a real one.
 */
async function merchantAccount(options?: { status?: string; commissionPct?: number }) {
  const service = db();
  const account = await staffUser('merchant');

  const { data: user } = await service.auth.admin.listUsers();
  const authUser = user.users.find((entry) => entry.email === account.email);
  if (!authUser) throw new Error('the fixture user was not found after creation');

  const stamp = randomUUID().slice(0, 8);
  const { data, error } = await service
    .from('merchants')
    .insert({
      slug: `e2e-merchant-${stamp}`,
      legal_name: `E2E Supplements ${stamp} SH.P.K.`,
      display_name: `E2E Supplements ${stamp}`,
      business_no: `ARBK-E2E-${stamp}`,
      contact_name: 'Arta Krasniqi',
      contact_email: account.email,
      contact_phone: '+383 44 000 000',
      address: { line1: 'Rr. Agim Ramadani 12', city: 'Prishtinë', country_code: 'XK' },
      bank_name: 'BKT',
      iban: 'XK051000000000009999',
      status: options?.status ?? 'approved',
      commission_pct: options?.commissionPct ?? 20,
      shipping_borne_by: 'biocode',
      terms_version: '1.0',
      terms_accepted_at: new Date().toISOString(),
    })
    .select('id, display_name')
    .single();

  if (error || !data) throw new Error(`fixture merchant failed: ${error?.message}`);
  const merchant = data as { id: string; display_name: string };
  merchantIds.push(merchant.id);

  const { error: linkError } = await service
    .from('merchant_users')
    .insert({ merchant_id: merchant.id, user_id: authUser.id, role: 'owner' });
  if (linkError) throw new Error(`membership failed: ${linkError.message}`);

  return { ...account, merchantId: merchant.id, displayName: merchant.display_name };
}

/** A published product with a known retail price and no BioCode stock. */
async function fixtureProduct(priceCents = 2000) {
  const service = db();
  const stamp = randomUUID().slice(0, 8);

  const { data: brand } = await service
    .from('brands')
    .insert({ slug: `brand-${stamp}`, name: `E2E Brand ${stamp}` })
    .select('id')
    .single();
  const brandId = (brand as { id: string }).id;
  brandIds.push(brandId);

  const { data: product } = await service
    .from('products')
    .insert({
      slug: `product-${stamp}`,
      brand_id: brandId,
      name: { sq: `Produkt E2E ${stamp}`, en: `E2E Product ${stamp}` },
      status: 'published',
      published_at: new Date().toISOString(),
    })
    .select('id, slug')
    .single();
  const row = product as { id: string; slug: string };
  productIds.push(row.id);

  const { data: variant } = await service
    .from('product_variants')
    .insert({
      product_id: row.id,
      sku: `SKU-${stamp}`,
      name: { sq: '60 kapsula', en: '60 capsules' },
      price_cents: priceCents,
      is_default: true,
      is_active: true,
    })
    .select('id, sku')
    .single();

  const v = variant as { id: string; sku: string };
  return { productId: row.id, slug: row.slug, variantId: v.id, sku: v.sku, priceCents };
}

test.describe('the portal before approval', () => {
  /**
   * A pending merchant has an account and almost nothing to do with it — and being told why is the
   * whole point of letting them in at all.
   */
  test('a pending merchant is told what is happening and can still upload documents', async ({
    page,
  }) => {
    const merchant = await merchantAccount({ status: 'pending' });
    await signIn(page, merchant.email, merchant.password);

    await page.goto('/en/merchant');
    await expect(page.getByRole('heading', { name: merchant.displayName })).toBeVisible();
    await expect(page.getByText('Your application is under review')).toBeVisible();

    // Offers are locked in the nav rather than hidden, so the shape of the portal is honest.
    const offersTab = page.getByRole('navigation', { name: 'Portal sections' }).getByText('Offers');
    await expect(offersTab).toBeVisible();
    await expect(offersTab).toHaveAttribute('aria-disabled', 'true');

    // Documents is the one section that works, because it is what unblocks approval.
    await page.getByRole('link', { name: 'Documents' }).click();
    await expect(page.getByRole('heading', { name: 'Documents', level: 2 })).toBeVisible();
    await expect(page.getByText('The business registration certificate is missing')).toBeVisible();
  });

  /** Typing the URL gets the same answer as the locked tab, not an empty list. */
  test('the offers URL is a 404 before approval', async ({ page }) => {
    const merchant = await merchantAccount({ status: 'pending' });
    await signIn(page, merchant.email, merchant.password);

    const response = await page.goto('/en/merchant/offers');
    expect(response?.status()).toBe(404);
  });
});

test.describe('the offer lifecycle, through the screens', () => {
  /**
   * The journey this milestone is for: a merchant lists stock, BioCode approves it, and the merchant
   * can see that it is actually selling.
   */
  test('create, submit, approve, and see it win the buy box', async ({ page, browser }) => {
    const merchant = await merchantAccount({ commissionPct: 20 });
    const product = await fixtureProduct(2000);

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/offers/new');

    // Find the product by its SKU, which is the search a merchant with a real catalogue would do.
    await page.locator('#q').fill(product.sku);
    // `exact`, or the navbar's "Open search" button matches too — accessible names are matched
    // as substrings by default, and the storefront chrome is on this page.
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await page.locator('#variantId').selectOption({ value: product.variantId });

    /*
     * The three numbers, and the relationship between them. €20.00 retail at 20% commission pays
     * €16.00, and this assertion is what proves the form is showing the merchant the deal rather
     * than just collecting a price from them.
     */
    await expect(page.getByText('€20.00').first()).toBeVisible();
    await expect(page.getByText('€16.00').first()).toBeVisible();

    await page.locator('#priceEuro').fill('12,50');
    await page.locator('#stockOnHand').fill('7');
    await page.locator('#handlingDays').fill('1');

    await page.getByRole('button', { name: 'Create the offer' }).click();

    // The form redirects to the list, where the new offer is awaiting review.
    await expect(page).toHaveURL(/\/merchant\/offers$/);
    const row = page.getByRole('row').filter({ hasText: product.sku });
    await expect(row).toBeVisible();
    await expect(row.getByText('In review')).toBeVisible();
    // A comma-typed price became cents, not twelve euro fifty thousand.
    await expect(row.getByText('€12.50')).toBeVisible();

    // ── The reviewer, in a separate context: a different session, not a different tab. ──
    const reviewer = await staffUser('product_manager');
    const staffContext = await browser.newContext();
    await staffContext.setExtraHTTPHeaders({ 'x-forwarded-for': '233.252.9.240' });
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, reviewer.email, reviewer.password);

    await staffPage.goto('/admin/merchants/offers');
    const card = staffPage.locator('article').filter({ hasText: product.sku });
    await expect(card).toBeVisible();

    // The signal the screen exists for: they ask €12.50 and settlement pays €16.00, so BioCode keeps
    // €3.50. A merchant asking more than settlement pays would be flagged instead.
    await expect(card.getByText('€3.50')).toBeVisible();

    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(staffPage.locator('article').filter({ hasText: product.sku })).toBeHidden();
    await staffContext.close();

    // ── Back in the portal: approved, and actually selling. ──
    await page.goto('/en/merchant/offers');
    const approved = page.getByRole('row').filter({ hasText: product.sku });
    await expect(approved.getByText('Approved')).toBeVisible();
    await expect(approved.getByText('In the buy box')).toBeVisible();

    await page.goto('/en/merchant');
    await expect(page.getByText('In the buy box')).toBeVisible();
  });

  /**
   * Stock is the edit a merchant makes daily, and zero is the one with a consequence: the offer stops
   * being supply. The portal has to say so on the same screen.
   */
  test('setting stock to zero takes the offer out of the buy box, and says so', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(1500);
    const service = db();

    await service.from('merchant_offers').insert({
      merchant_id: merchant.merchantId,
      variant_id: product.variantId,
      price_cents: 1000,
      stock_on_hand: 5,
      status: 'approved',
    });

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/offers');

    const row = page.getByRole('row').filter({ hasText: product.sku });
    await expect(row.getByText('In the buy box')).toBeVisible();

    await row.getByRole('spinbutton').fill('0');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByText('Saved')).toBeVisible();
    await page.reload();

    const after = page.getByRole('row').filter({ hasText: product.sku });
    await expect(after.getByText('No stock — not shown in the shop.')).toBeVisible();
    await expect(after.getByText('In the buy box')).toBeHidden();
  });

  /** Pausing is what a merchant reaches for when they have sold the last one at the counter. */
  test('pausing a live offer removes it from the buy box', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(1500);

    await db().from('merchant_offers').insert({
      merchant_id: merchant.merchantId,
      variant_id: product.variantId,
      price_cents: 1000,
      stock_on_hand: 5,
      status: 'approved',
    });

    await signIn(page, merchant.email, merchant.password);
    await page.goto('/en/merchant/offers');

    const row = page.getByRole('row').filter({ hasText: product.sku });
    await row.getByRole('button', { name: 'Pause' }).click();

    /*
     * No reload. The action calls `revalidatePath`, so the server component re-renders in place and
     * the row is expected to change on its own — which is also the behaviour a merchant sees.
     *
     * The first version of this test reloaded immediately after the click, which raced the in-flight
     * POST: the navigation aborted the action and the row was still "Approved". Waiting on the
     * outcome rather than forcing a fetch is both correct and what the user experiences.
     */
    await expect(row.getByText('Paused')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(row.getByText('In the buy box')).toBeHidden();
  });
});

test.describe('the boundary (docs/16 §5)', () => {
  /**
   * 404, not 403 and not a redirect. A redirect confirms the surface exists behind an authorisation
   * check; a merchant is a counterparty and should not learn the shape of BioCode's admin panel.
   */
  test('a merchant reaching /admin gets 404', async ({ page }) => {
    const merchant = await merchantAccount();
    await signIn(page, merchant.email, merchant.password);

    const response = await page.goto('/admin');
    expect(response?.status()).toBe(404);

    const orders = await page.goto('/admin/orders');
    expect(orders?.status()).toBe(404);
  });

  /** And the offer review queue is staff-only, by capability rather than by URL obscurity. */
  test('a merchant cannot reach the offer review queue', async ({ page }) => {
    const merchant = await merchantAccount();
    await signIn(page, merchant.email, merchant.password);

    const response = await page.goto('/admin/merchants/offers');
    expect(response?.status()).toBe(404);
  });

  /**
   * The settings form shows what a merchant may not change, and the database is what refuses it. This
   * asserts the screen tells the truth about the boundary rather than hiding it.
   */
  test('the settings page marks the commission as fixed', async ({ page }) => {
    const merchant = await merchantAccount({ commissionPct: 20 });
    await signIn(page, merchant.email, merchant.password);

    await page.goto('/en/merchant/settings');
    await expect(page.getByRole('heading', { name: 'Fixed' })).toBeVisible();
    await expect(page.getByText('20%')).toBeVisible();
    // The IBAN is never prefilled — the portal holds only the last four digits.
    await expect(page.locator('#iban')).toHaveValue('');
    await expect(page.getByText('On file: ••••9999')).toBeVisible();
  });
});

test.describe('who the customer is buying from (docs/16 §1)', () => {
  /**
   * The seller line on the PDP. It is a marketplace disclosure rather than decoration: the sale is
   * always BioCode↔customer, and a shopper who cannot tell who is behind a listing cannot tell who
   * to hold to a promise about it.
   */
  test('a BioCode-stocked product names BioCode as the seller', async ({ page }) => {
    await page.goto('/en/product/on-gold-standard-whey');
    await expect(page.getByText('Sold and shipped by BioCode')).toBeVisible();
  });

  test('the Albanian page says it in Albanian', async ({ page }) => {
    await page.goto('/product/on-gold-standard-whey');
    await expect(page.getByText('Shitur dhe dërguar nga BioCode')).toBeVisible();
  });

  /**
   * A merchant-only variant is **not** purchasable yet, and the page must not pretend otherwise.
   *
   * Merchant supply becomes orderable with routing (docs/16 §12 step 4), because an order nobody can
   * route is worse for the customer than a product marked out of stock. Until then the honest render
   * is the out-of-stock line and no seller attribution — asserted here so the day that changes, this
   * test changes with it deliberately rather than by accident.
   */
  test('a merchant-only variant is out of stock and names no seller', async ({ page }) => {
    const merchant = await merchantAccount();
    const product = await fixtureProduct(1500);

    await db().from('merchant_offers').insert({
      merchant_id: merchant.merchantId,
      variant_id: product.variantId,
      price_cents: 1000,
      stock_on_hand: 20,
      status: 'approved',
    });

    await page.goto(`/en/product/${product.slug}`);

    // The button, not the status line: "out of stock" appears in both, and the disabled button is
    // the claim that matters — the variant genuinely cannot be bought.
    await expect(page.getByRole('button', { name: 'Currently out of stock' })).toBeDisabled();
    await expect(page.getByText(`shipped by ${merchant.displayName}`)).toBeHidden();
  });
});

test.describe('unauthenticated', () => {
  test('the portal sends a stranger to sign in, not to a 404', async ({ page }) => {
    await page.goto('/en/merchant');
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  /** The application form is the one public route under /merchant, and it stays public. */
  test('the application form is reachable without an account', async ({ page }) => {
    const response = await page.goto('/en/merchant/apply');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /Sell on BioCode/i })).toBeVisible();
  });
});

/** Guards against the fixture users leaking if `afterAll` never runs. */
test.afterAll(() => {
  if (createdUsers.length > 0) {
    console.warn(`[marketplace] ${createdUsers.length} fixture users left for the global teardown`);
  }
});
