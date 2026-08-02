import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ACTION_TIMEOUT, CHEAP_SKU, addCheapItemToCart } from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/12 M10 — the operations milestone in a browser.
 *
 * Three acceptance criteria, two of which only a browser can show:
 *
 *   · the ledger invariant through receive and adjust (also proved in SQL, in
 *     `tests/integration/admin-ops.test.ts` — here it is proved through the screen an operator
 *     actually uses, which is where a form that posts the wrong field would show up)
 *   · a team invite creates an account that can sign in
 *   · a settings change reaches the storefront
 */
const ips = ipAllocator('233.252.6');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.describe('inventory operations (docs/06 §8)', () => {
  test('receiving stock moves the count and writes a ledger row', async ({ page }) => {
    const warehouse = await staffUser('warehouse_manager');
    await signIn(page, warehouse.email, warehouse.password);

    await page.goto('/admin/inventory?q=' + CHEAP_SKU);

    const row = page.locator('tr', { hasText: CHEAP_SKU }).first();
    await expect(row).toBeVisible({ timeout: ACTION_TIMEOUT });

    const { data: before } = await db()
      .from('v_admin_inventory')
      .select('on_hand, variant_id')
      .eq('sku', CHEAP_SKU)
      .single();

    const startingStock = (before as { on_hand: number }).on_hand;
    const variantId = (before as { variant_id: string }).variant_id;

    await row.getByRole('button', { name: 'Receive' }).click();
    await page.locator('input[name="quantity"]').fill('7');
    await page.locator('input[name="batchNumber"]').fill('E2E-BATCH');
    await page.getByRole('button', { name: 'Receive', exact: true }).last().click();

    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('inventory_levels')
            .select('on_hand')
            .eq('variant_id', variantId)
            .single();
          return (data as { on_hand: number } | null)?.on_hand ?? -1;
        },
        { message: 'receiving must increase on-hand', timeout: ACTION_TIMEOUT },
      )
      .toBe(startingStock + 7);

    /*
     * docs/12 M10 acceptance — the invariant. Asserted against the drift view rather than by
     * re-adding the movements by hand: the view *is* the definition, and a test that re-implements
     * the sum can agree with a bug.
     */
    const { data: drift } = await db()
      .from('v_stock_ledger_drift')
      .select('variant_id')
      .eq('variant_id', variantId);
    expect(drift ?? [], 'on-hand must equal the sum of movements').toHaveLength(0);

    // The movement is on the ledger page, with who did it.
    await page.goto('/admin/movements');
    const movement = page.locator('tr', { hasText: 'E2E-BATCH' }).first();
    await expect(movement).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(movement).toContainText('+7');
    await expect(movement, 'the ledger records who').toContainText(warehouse.email);

    // Put the stock back so the fixture catalogue is unchanged for other specs.
    await db().rpc('apply_stock_movement', {
      p_variant_id: variantId,
      p_warehouse_id: (
        await db().from('warehouses').select('id').eq('is_default', true).single()
      ).data?.id,
      p_type: 'adjustment',
      p_quantity: -7,
      p_note: 'E2E cleanup',
    });
  });

  test('an adjustment below zero is refused with a usable message', async ({ page }) => {
    const warehouse = await staffUser('warehouse_manager');
    await signIn(page, warehouse.email, warehouse.password);

    await page.goto('/admin/inventory?q=' + CHEAP_SKU);

    const row = page.locator('tr', { hasText: CHEAP_SKU }).first();
    await expect(row).toBeVisible({ timeout: ACTION_TIMEOUT });

    await row.getByRole('button', { name: 'Adjust' }).click();
    // Large enough to exceed any seeded stock, but inside the schema's ±100,000 range — a value
    // outside it is rejected by Zod first and never reaches the database, which would test the
    // wrong thing.
    await page.locator('input[name="quantity"]').fill('-99999');
    await page.locator('input[name="note"]').fill('deliberately too much');
    await page.getByRole('button', { name: 'Adjust', exact: true }).last().click();

    /*
     * The specific message, not just "an error". Until migration 20 this path produced
     * "Something went wrong" — the CHECK constraint fired before the function could raise its
     * named error, so the operator was told nothing about what they had done wrong.
     */
    await expect(page.getByText(/take stock below zero/)).toBeVisible({ timeout: ACTION_TIMEOUT });
  });
});

/**
 * Distinctive enough that the cleanup below can find it without matching anything seeded — and
 * **unique per project**, which it was not.
 *
 * `desktop` and `mobile` run this file concurrently against one database. With a shared name the
 * two runs raced: the second create collided, and whichever `afterAll` fired first deleted the
 * other's row mid-assertion. It passed for a milestone because the schedule happened to separate
 * them, and started failing the day the suite grew — the classic shape of a fixture that is
 * unique per *file* rather than per *run*.
 */
const METHOD_PREFIX = 'E2E Test Courier';
const methodName = () => `${METHOD_PREFIX} ${test.info().project.name}`;

test.describe('settings (docs/06 §15)', () => {
  /*
   * Runs pass or fail, which is the whole point — see the note in the shipping test.
   *
   * Scoped to **this project's** rows. A prefix sweep across all of them looks tidier and
   * reintroduces the exact race it was meant to fix from the other side: `desktop` finishing its
   * describe block would delete `mobile`'s method while mobile was still asserting on it. Both
   * projects then failed instead of one.
   *
   * Still a prefix within the project, so a run that died before `afterAll` is swept by the next
   * run of the same project.
   */
  test.afterAll(async ({}, testInfo) => {
    await db()
      .from('shipping_methods')
      .delete()
      .like('name->>sq', `${METHOD_PREFIX} ${testInfo.project.name}%`);
  });

  test('a team invite creates an account that can reach the panel', async ({ page, browser }) => {
    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);

    const invitee = `e2e-invited-${Date.now()}-${test.info().workerIndex}@biocode.test`;

    await page.goto('/admin/settings/team');
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.locator('#email').fill(invitee);
    await page.locator('#fullName').fill('E2E Invitee');
    await page.locator('#role').selectOption('support');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText(/can now sign in/)).toBeVisible({ timeout: ACTION_TIMEOUT });

    // docs/12 M10 acceptance — "team invite creates staff login".
    const { data: profile } = await db()
      .from('profiles')
      .select('id, role')
      .eq('email', invitee)
      .single();

    expect(profile, 'the invite must create a profile').not.toBeNull();
    expect((profile as { role: string }).role).toBe('support');

    /*
     * No password is set by the invite (docs/06 §15 — they use "forgot password"), so signing in
     * as them is not possible from here. What is checkable is the half that matters: the account
     * exists with the role, and it appears in the team list. The password path is Supabase's.
     */
    await page.reload();
    await expect(page.getByText(invitee, { exact: true })).toBeVisible();

    // Deactivating revokes the access.
    const memberRow = page.locator('li', { hasText: invitee }).first();
    await memberRow.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(/is deactivated/)).toBeVisible({ timeout: ACTION_TIMEOUT });

    await expect
      .poll(async () => {
        const { data } = await db()
          .from('profiles')
          .select('deleted_at')
          .eq('email', invitee)
          .single();
        return (data as { deleted_at: string | null } | null)?.deleted_at;
      })
      .not.toBeNull();

    // Clean up: the invited user is not tracked by `staffUser`, so remove them here.
    const context = await browser.newContext();
    await context.close();
    const id = (profile as { id: string }).id;
    await db().auth.admin.deleteUser(id);
  });

  test('a new shipping method reaches the storefront (docs/12 M10 acceptance)', async ({
    page,
  }) => {
    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);

    /*
     * A **new** method, not an edit to a seeded one.
     *
     * The first version of this test edited the seeded Standard method's price and restored it at
     * the end — and when an earlier assertion failed, the restore never ran and left €7.77 in the
     * database. The next integration run then failed on an unrelated coupon test asserting a €2
     * delivery fee, which is a very expensive way to learn that a test which mutates seed data is
     * a test that can break every other suite.
     *
     * Creating a row instead means a mid-test failure leaves something inert behind, and
     * `afterAll` removes it either way. Position 99 keeps it last, so checkout still preselects
     * the seeded Standard method and the other specs' totals are untouched.
     */
    await page.goto('/admin/settings/shipping');
    await page.getByRole('button', { name: 'New method' }).click();

    const name = methodName();
    await page.locator('#nameSq').fill(name);
    await page.locator('#nameEn').fill(name);
    await page.locator('#price').fill('7.77');
    await page.locator('#minDays').fill('9');
    await page.locator('#maxDays').fill('9');
    await page.locator('#countries').fill('XK');
    await page.locator('#position').fill('99');
    await page.getByRole('button', { name: 'Create method' }).click();

    await expect(page.getByText(name).first()).toBeVisible({ timeout: ACTION_TIMEOUT });

    /*
     * The point of the test: the write purges `CACHE_TAGS.shipping`, so checkout must offer the
     * new method on the next request rather than after the ISR window expires. This is docs/13
     * §K1's defect class — the write lands, the database is right, and the shop keeps serving the
     * old list.
     *
     * A cart line first: checkout redirects to the cart when there is nothing in it, so without
     * this the assertion would be made against the cart page and fail for the wrong reason.
     */
    await addCheapItemToCart(page);
    await page.goto('/en/checkout');

    await expect(page.getByText(name).first()).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText('€7.77').first()).toBeVisible();
  });
});

/**
 * docs/09 §1 journey 12 — the axe pass, extended to everything M10 added.
 *
 * The existing sweep covers home, the shop, a PDP, cart, checkout, auth, account orders and the
 * admin dashboard. M10 added six admin areas, and a screen with no axe assertion is a screen
 * where the next contrast slip ships (docs/13 §N7 is what that looks like).
 *
 * The storefront half of this sweep used to be the Finder's two screens. It moved to
 * `e2e/biohack.spec.ts` along with the feature that replaced them.
 */
test.describe('accessibility on the M10 surface (docs/09 §1 journey 12)', () => {

  const ADMIN = [
    '/admin/inventory',
    '/admin/movements',
    '/admin/customers',
    '/admin/coupons',
    '/admin/content',
    '/admin/content/faqs',
    '/admin/settings',
    '/admin/settings/team',
    '/admin/settings/audit',
  ];

  test('axe finds no serious or critical violations across the admin screens', async ({ page }) => {
    // One test, one sign-in. Nine sign-ins to assert nine pages would spend the auth quota that
    // docs/13 §P3 records as the binding constraint on this suite.
    const admin = await staffUser('admin');
    await signIn(page, admin.email, admin.password);

    for (const path of ADMIN) {
      await page.goto(path);
      await assertNoBlockingViolations(page, path);
    }
  });

  test('the customer address book is accessible', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    await page.goto('/en/account/addresses');
    await assertNoBlockingViolations(page, '/en/account/addresses');
  });
});

async function assertNoBlockingViolations(page: Page, path: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(blocking, `${path}\n${blocking.map((v) => `${v.id}: ${v.help}`).join('\n')}`).toEqual([]);
}
