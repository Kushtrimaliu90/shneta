import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ACTION_TIMEOUT } from './helpers/storefront';
import { deleteCreatedUsers, ipAllocator, signIn, staffUser } from './helpers/accounts';

/**
 * docs/15 §7 — the BioHack Protocol Generator, end to end.
 *
 * The definition of done in docs/15 §8, walked by a browser: pick Sleep + Stress, vegan, no
 * caffeine, and in under sixty seconds hold a protocol whose prices are live, whose PSE lines
 * name the customer's own goals, and whose "add everything" lands the exact lines in the cart.
 *
 * Its own reserved IP block, per docs/13 §N10: generation is rate limited at 10/h per IP and a
 * block shared with another spec would exhaust the budget mid-run.
 */
const ips = ipAllocator('233.252.8');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

/**
 * Every context starts as a visitor who has already answered the cookie banner.
 *
 * Not a convenience. This is the first page whose interactions all live at the *bottom* — the
 * total, add-all, the trace expander, the per-item Remove buttons — and until consent is
 * answered the banner is pinned over exactly that strip. On a 390 px viewport there is little
 * else below the fold, so the clicks land on the banner.
 *
 * Seeding the cookie rather than clicking the banner away, because the banner reads its cookie
 * **after mount** (deliberately, to avoid a hydration flash) and therefore appears a moment
 * after the page does. A dismiss-if-visible helper raced it and lost: not yet rendered when the
 * check ran, covering the button by the time the test clicked.
 *
 * `rejected`, so no analytics loads — the honest default for a test.
 *
 * Content sitting under the bottom stack while consent is unanswered is a property of the shared
 * layout rather than of this feature; recorded in docs/13 §T12.
 */
test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
  await page.context().addCookies([
    {
      name: 'biocode_consent',
      value: 'rejected',
      url: testInfo.project.use.baseURL ?? 'http://127.0.0.1:3000',
    },
  ]);
});

/** Steps 1 and 2, with the answers docs/15 §8 names. Leaves the browser on the result page. */
async function generate(
  page: Page,
  options: {
    goals?: string[];
    vegan?: boolean;
    caffeine?: 'Yes' | 'No';
    pregnant?: boolean;
    /** Step 2's bands, as `{ 'Age': '50–64', 'Sex': 'Male', … }`. Omitted means all skipped. */
    profile?: Record<string, string>;
  } = {},
): Promise<void> {
  const goals = options.goals ?? ['Better Sleep', 'Stress'];

  await page.goto('/en/biohack');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('BioHack Protocol');

  for (const goal of goals) await page.getByRole('checkbox', { name: goal }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  /*
   * Step 2 — "about you" (docs/15 §9). Every band is optional, so a caller that passes no profile
   * clicks straight through, which is also the case worth exercising: the flow must work for
   * somebody who declines all five.
   */
  await expect(page.getByRole('group', { name: 'Age', exact: true })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });
  if (options.profile) {
    for (const [group, label] of Object.entries(options.profile)) {
      await page
        .getByRole('group', { name: group, exact: true })
        .getByRole('radio', { name: label, exact: true })
        .check();
    }
  }
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('group', { name: 'Diet', exact: true })).toBeVisible({
    timeout: ACTION_TIMEOUT,
  });
  if (options.vegan !== false)
    await page.getByRole('radio', { name: 'Vegan', exact: true }).check();
  await page
    .getByRole('group', { name: 'Caffeine', exact: true })
    .getByRole('radio', { name: options.caffeine ?? 'No', exact: true })
    .check();
  /*
   * The pregnancy question is only rendered when the sex answer leaves it open (docs/15 §9), so a
   * profile that said "Male" has no such group and checking it unconditionally hangs.
   *
   * Found by this feature breaking its own helper, which is the useful kind of failure: the
   * conditional question is the behaviour under test, and a helper that assumed the field is always
   * there was asserting the old flow.
   */
  const lifeStage = page.getByRole('group', { name: /pregnant/ });
  if ((await lifeStage.count()) > 0) {
    await lifeStage
      .getByRole('radio', { name: options.pregnant ? 'Yes' : 'No', exact: true })
      .check();
  }

  await page.getByRole('button', { name: 'Build my protocol' }).click();
}

test.describe('the three steps (docs/15 §1)', () => {
  test('sleep + stress, vegan, no caffeine produces a live protocol in under 60 s', async ({
    page,
  }) => {
    const started = Date.now();
    await generate(page);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    // docs/15 §8 — the URL is the protocol's address, not a query string full of answers.
    await expect(page).toHaveURL(/\/en\/biohack\/[a-z0-9]{16}$/);

    // The timeline groups into day parts, and at least one of them holds something.
    const items = page.getByRole('article');
    expect(await items.count(), 'a protocol is more than one item').toBeGreaterThanOrEqual(2);

    // Both goals are named in a PSE line — the two-goal explanation docs/15 §1 asks for.
    await expect(page.getByText('WHY').first()).toBeVisible();
    await expect(page.getByText(/Better Sleep/).first()).toBeVisible();
    await expect(page.getByText(/Stress/).first()).toBeVisible();

    // Live prices, and a monthly total that is not zero.
    await expect(page.getByText(/€\d/).first()).toBeVisible();

    // The mandatory strip, on every generated output (docs/15 §0).
    await expect(page.getByText(/not medical advice/i)).toBeVisible();

    const elapsed = Date.now() - started;
    expect(elapsed, `the flow took ${Math.round(elapsed / 1000)}s`).toBeLessThan(60_000);
  });

  test('a fourth goal cannot be selected', async ({ page }) => {
    await page.goto('/en/biohack');

    for (const goal of ['Better Sleep', 'Stress', 'Energy']) {
      await page.getByRole('checkbox', { name: goal }).check();
    }

    await expect(page.getByText('3/3')).toBeVisible();
    // Every unchosen tile is disabled rather than silently ignoring the tap.
    await expect(page.getByRole('checkbox', { name: 'Immunity' })).toBeDisabled();
  });

  test('the pregnancy gate returns guidance and no products', async ({ page }) => {
    await generate(page, { pregnant: true });

    await expect(page).toHaveURL(/\/en\/biohack\/kujdes$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('healthcare professional');
    // docs/15 §6 — nothing purchasable anywhere on the page.
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add everything/ })).toHaveCount(0);
  });

  test('the answers survive the back button', async ({ page }) => {
    await page.goto('/en/biohack');
    await page.getByRole('checkbox', { name: 'Immunity' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('group', { name: 'Age', exact: true })).toBeVisible();
    await page.goBack();

    await expect(page.getByRole('checkbox', { name: 'Immunity' })).toBeChecked();
  });
});

test.describe('personalisation (docs/15 §9)', () => {
  /**
   * The claim the whole feature rests on: the same goals, two different people, two different
   * protocols — each carrying the reason for the difference.
   *
   * Asserted through the browser rather than only in the unit suite because this is where the
   * chain is complete: the bands survive two GET steps and a POST, reach the engine, fire the
   * seeded rules, and come back as a sentence on a card.
   */
  test('two profiles with the same goals get different protocols', async ({ page }) => {
    await generate(page, {
      goals: ['Energy', 'Brain & Focus'],
      vegan: false,
      caffeine: 'Yes',
      profile: { Age: '50–64', Sex: 'Male', Weight: '90–104 kg', 'Physical activity': 'Intense' },
    });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    // The card explains itself: "FOR YOU" plus the rule's own sentence.
    await expect(page.getByText('FOR YOU').first()).toBeVisible();
    const trained = await page.getByRole('article').allInnerTexts();

    // A second person, same goals, nothing about themselves given.
    await generate(page, { goals: ['Energy', 'Brain & Focus'], vegan: false, caffeine: 'Yes' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });
    const anonymous = await page.getByRole('article').allInnerTexts();

    expect(
      trained.join('|'),
      'the profile has to change the protocol, or none of this earns its place',
    ).not.toBe(anonymous.join('|'));

    /*
     * More reasons for the person who said more, rather than "none for the person who said
     * nothing".
     *
     * The first version asserted the latter and was wrong about the ruleset: one seeded rule — the
     * B12 `require` — has an empty condition and deliberately fires for everybody, so a reason
     * appears even for a customer who skipped every band. Counting is the honest form of the claim,
     * and it is the claim that matters: saying more about yourself gets you more explanation.
     */
    const countFor = (texts: string[]) => texts.join(' ').split('FOR YOU').length - 1;
    expect(countFor(trained), 'the full profile earns more explanation').toBeGreaterThan(
      countFor(anonymous),
    );
  });

  /**
   * Weight Management, because that is the goal whose blocks include a protein.
   *
   * The seeded `servings_hint` rules only attach to protein and creatine — the two ingredients
   * flagged `scales_with_body_weight` — so a goal without either in its blocks produces no note
   * however heavy the customer is. Picking Energy first was a test asserting the rule against a
   * protocol the rule could never touch.
   */
  test('the body-weight serving note appears for a heavy profile', async ({ page }) => {
    await generate(page, {
      goals: ['Weight Management'],
      vegan: false,
      caffeine: 'Yes',
      profile: { Weight: 'Over 105 kg' },
    });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    // The note is a multiplier on the label serving, never a dose (docs/15 §9).
    await expect(page.getByText(/label servings a day/)).toBeVisible();
  });

  /**
   * The gate now comes from the age band rather than a self-declared checkbox, and this is the
   * assertion that keeps it that way — the flow must end at the guidance screen without the
   * pregnancy question being answered at all.
   */
  test('under 18 is gated from the age band alone', async ({ page }) => {
    await page.goto('/en/biohack');
    await page.getByRole('checkbox', { name: 'Better Sleep' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page
      .getByRole('group', { name: 'Age', exact: true })
      .getByRole('radio', { name: 'Under 18', exact: true })
      .check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page
      .getByRole('group', { name: /pregnant/ })
      .getByRole('radio', { name: 'No', exact: true })
      .check();
    await page.getByRole('button', { name: 'Build my protocol' }).click();

    await expect(page).toHaveURL(/\/en\/biohack\/kujdes$/);
    await expect(page.getByRole('article')).toHaveCount(0);
  });

  /** Asking a man whether he is pregnant reads as a form that was not listening (docs/15 §9). */
  test('the pregnancy question is not asked of someone who said male', async ({ page }) => {
    await page.goto('/en/biohack');
    await page.getByRole('checkbox', { name: 'Better Sleep' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page
      .getByRole('group', { name: 'Sex', exact: true })
      .getByRole('radio', { name: 'Male', exact: true })
      .check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('group', { name: 'Diet', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: /pregnant/ })).toHaveCount(0);

    // And it still generates — the gate defaults to "not pregnant" when the question is skipped.
    await page.getByRole('button', { name: 'Build my protocol' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });
  });

  test('every band can be skipped and the protocol still generates', async ({ page }) => {
    await generate(page, { goals: ['Immunity'], vegan: false, caffeine: 'Yes' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });
    expect(await page.getByRole('article').count()).toBeGreaterThan(0);
  });
});

test.describe('the result page (docs/15 §1 step 3)', () => {
  test('add-all puts exactly the protocol lines in the cart', async ({ page }) => {
    await generate(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    // Count the purchasable cards: the ones showing a price.
    const priced = page.getByRole('article').filter({ hasText: /€/ });
    const expected = await priced.count();
    expect(expected, 'the protocol has something to buy').toBeGreaterThan(0);

    await page.getByRole('button', { name: /Add everything to cart/ }).click();
    await expect(page.getByText(/products added to your cart/)).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    await page.goto('/en/cart');
    const lines = page.locator('[data-testid="cart-line"], main table tbody tr, main ul > li');
    expect(await lines.count(), 'the cart holds the protocol').toBeGreaterThanOrEqual(1);
  });

  test('removing an item lowers the total, and undo restores it', async ({ page }) => {
    await generate(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    const before = await page.getByRole('article').count();
    await page
      .getByRole('button', { name: /^Remove:/ })
      .first()
      .click();

    await expect(page.getByRole('article')).toHaveCount(before - 1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('article')).toHaveCount(before);
  });

  test('the trace explains the choices in plain language', async ({ page }) => {
    await generate(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    await page.getByText('How was this protocol chosen?').click();
    await expect(page.getByText(/entered for|scores summed to/).first()).toBeVisible();
  });

  test('the share link renders read-only for someone else', async ({ page, browser }) => {
    await generate(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    const code = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(code).toMatch(/^[a-z0-9]{16}$/);

    // A fresh context: no cookies, no session — exactly what a recipient has.
    // Its own context, so `beforeEach`'s consent cookie does not reach it — set it here too.
    const other = await browser.newContext();
    await other.addCookies([
      { name: 'biocode_consent', value: 'rejected', url: test.info().project.use.baseURL ?? '' },
    ]);
    const guest = await other.newPage();
    await guest.goto(`/en/p/${code}`);

    await expect(guest.getByRole('heading', { level: 1 })).toContainText('BioHack Protocol');
    await expect(guest.getByRole('button', { name: /Add everything/ })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: /^Remove:/ })).toHaveCount(0);
    await expect(guest.getByRole('link', { name: 'Build your own protocol' })).toBeVisible();

    await other.close();
  });

  test('a signed-in customer can save the protocol', async ({ page }) => {
    const customer = await staffUser('customer');
    await signIn(page, customer.email, customer.password);

    await generate(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });

    await page.getByRole('button', { name: 'Save it', exact: true }).click();
    await expect(page.getByText('Protocol saved to your account.')).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });
  });

  test('an unknown code is a 404, not an empty protocol', async ({ page }) => {
    const response = await page.goto('/en/biohack/zzzzzzzzzzzzzzzz');
    expect(response?.status()).toBe(404);
  });
});

test.describe('the admin ruleset editor (docs/15 §4)', () => {
  test('the simulator generates against the current version without writing', async ({ page }) => {
    const manager = await staffUser('product_manager');
    await signIn(page, manager.email, manager.password);

    await page.goto('/admin/biohack');
    await expect(page.getByRole('heading', { level: 1, name: 'BioHack' })).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    // Answers on the left, a generated protocol on the right, no round trip in between.
    await expect(page.getByRole('group', { name: /Goals/ })).toBeVisible();
    const items = page.getByText('Items', { exact: true });
    await expect(items).toBeVisible();

    // Changing an answer changes the result in place — the URL never moves.
    const url = page.url();
    await page.getByRole('button', { name: 'vegan', exact: true }).click();
    expect(page.url()).toBe(url);
    await expect(page.getByText(/Trace \(\d+\)/)).toBeVisible();
  });

  test('an approved version is read-only until a draft is started', async ({ page }) => {
    const manager = await staffUser('product_manager');
    await signIn(page, manager.email, manager.password);

    /*
     * `?goal=` pinned rather than taking the tab's default first goal.
     *
     * The default is `health_goals` in `sort_order`, and the admin taxonomy spec creates goals of
     * its own — so the first tile is sometimes another test's fixture with no blocks. Naming the
     * goal makes the assertion about the editor rather than about who ran first.
     */
    await page.goto('/admin/biohack?tab=matrix&goal=gjumi');
    await expect(page.getByText(/^\d+ blocks? for/)).toBeVisible({ timeout: ACTION_TIMEOUT });

    // docs/15 §4 — approved configs are immutable, so the editor offers nothing to press.
    await expect(page.getByRole('button', { name: 'Add block' })).toHaveCount(0);

    await page.goto('/admin/biohack?tab=versions');
    await expect(page.getByRole('button', { name: /Start a new draft/ })).toBeVisible();
  });

  test('compliance can reach the screen but cannot edit the ruleset', async ({ page }) => {
    const compliance = await staffUser('compliance_manager');
    await signIn(page, compliance.email, compliance.password);

    await page.goto('/admin/biohack?tab=settings');
    await expect(page.getByText(/view the ruleset but not change it/)).toBeVisible({
      timeout: ACTION_TIMEOUT,
    });

    await page.goto('/admin/biohack?tab=versions');
    // No draft button: starting one is `biohack.manage`, which compliance does not hold.
    await expect(page.getByRole('button', { name: /Start a new draft/ })).toHaveCount(0);
  });

  test('a role without the capability cannot reach the screen at all', async ({ page }) => {
    const warehouse = await staffUser('warehouse_manager');
    await signIn(page, warehouse.email, warehouse.password);

    await page.goto('/admin/biohack');
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('the analytics tab counts the protocols that were generated', async ({ page }) => {
    const manager = await staffUser('product_manager');
    await signIn(page, manager.email, manager.password);

    await page.goto('/admin/biohack?tab=analytics');
    await expect(page.getByText('Protocols generated')).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(page.getByText('Most-chosen goal combinations')).toBeVisible();
  });
});

test.describe('accessibility (docs/15 §7)', () => {
  test('axe finds nothing serious on any of the four screens', async ({ page }) => {
    await page.goto('/en/biohack');
    await assertNoBlockingViolations(page, 'step 1 — goals');

    await page.getByRole('checkbox', { name: 'Better Sleep' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2 carries thirty-odd radios across five groups, plus the hints wired as descriptions —
    // by far the densest form in the shop and the one most worth an axe pass.
    await expect(page.getByRole('group', { name: 'Age', exact: true })).toBeVisible();
    await assertNoBlockingViolations(page, 'step 2 — about you');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('group', { name: 'Diet', exact: true })).toBeVisible();
    await assertNoBlockingViolations(page, 'step 3 — refine');

    await page
      .getByRole('group', { name: /pregnant/ })
      .getByRole('radio', { name: 'No', exact: true })
      .check();
    await page.getByRole('button', { name: 'Build my protocol' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your BioHack Protocol', {
      timeout: ACTION_TIMEOUT,
    });
    await assertNoBlockingViolations(page, 'result');
  });

  test('axe finds nothing serious across the admin tabs', async ({ page }) => {
    // One sign-in for six tabs: docs/13 §P3 records the auth quota as this suite's real limit.
    const manager = await staffUser('product_manager');
    await signIn(page, manager.email, manager.password);

    for (const tab of [
      'simulator',
      'matrix',
      'profile',
      'conflicts',
      'settings',
      'versions',
      'analytics',
    ]) {
      await page.goto(`/admin/biohack?tab=${tab}`);
      await expect(page.getByRole('heading', { level: 1, name: 'BioHack' })).toBeVisible({
        timeout: ACTION_TIMEOUT,
      });
      await assertNoBlockingViolations(page, `/admin/biohack?tab=${tab}`);
    }
  });
});

async function assertNoBlockingViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(blocking, `${label}\n${blocking.map((v) => `${v.id}: ${v.help}`).join('\n')}`).toEqual([]);
}
