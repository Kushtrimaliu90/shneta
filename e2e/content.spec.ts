import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ACTION_TIMEOUT } from './helpers/storefront';
import { db, deleteCreatedUsers, ipAllocator } from './helpers/accounts';

/**
 * docs/09 §1 journey 11 — i18n across the content pages — plus the rest of M8: the Knowledge
 * Center, offers, contact, the FAQ and the cookie banner.
 *
 * These pages are anonymous, so most of the file never signs in. The block is reserved anyway
 * because the contact form is rate-limited per address (3/hour), and a shared block would mean
 * the fourth contact test in a run failing for somebody else's reason.
 */
const ips = ipAllocator('233.252.4');

test.afterAll(deleteCreatedUsers);
test.beforeAll(() => ips.reset());

test.beforeEach(async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ips.next(testInfo.workerIndex) });
});

test.describe('journey 11 — the content pages in both languages', () => {
  test('the knowledge hub renders translated chrome in each locale', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dituri');

    await page.goto('/en/knowledge');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Knowledge');

    // Six seeded articles, and the type filter counts them.
    await expect(page.getByRole('link', { name: /^All/ })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('an Albanian-only article falls back with a note on /en (docs/05 §7)', async ({ page }) => {
    /*
     * The acceptance criterion, exactly. The seeded news item has no English body on purpose —
     * it is the piece most likely to stay untranslated in real life, so it is the one that
     * proves an English reader gets the Albanian text and is told why, rather than a blank page.
     */
    await page.goto('/en/knowledge/biocode-tani-ne-kosove');

    await expect(page.getByText('This piece is only available in Albanian for now.')).toBeVisible();
    // …and the body really is there, not just the note.
    await expect(page.getByText('Pagesa në dorëzim')).toBeVisible();

    // On the Albanian page the same article is not a fallback, so no note.
    await page.goto('/knowledge/biocode-tani-ne-kosove');
    await expect(page.getByText('This piece is only available in Albanian for now.')).toHaveCount(
      0,
    );
  });

  test('markdown renders as markup, not as text', async ({ page }) => {
    await page.goto('/en/knowledge/si-te-zgjedhesh-proteinen-e-duhur');

    // docs/05 §7 acceptance — headings, lists, tables. A table is the one most likely to be
    // silently dropped, because it needs remark-gfm rather than core markdown.
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Lactose' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What the choice depends on' })).toBeVisible();
    await expect(page.getByRole('list').first()).toBeVisible();
  });

  test('an external link in an article is rel-protected (docs/08 §3)', async ({ page }) => {
    await page.goto('/en/knowledge/cfare-thote-shkenca-per-kreatinen');

    const external = page.getByRole('link', { name: /International Society of Sports Nutrition/ });
    await expect(external).toHaveAttribute('rel', 'noopener nofollow');
    await expect(external).toHaveAttribute('target', '_blank');
  });

  test('"Shop this article" links to real products', async ({ page }) => {
    await page.goto('/en/knowledge/udhezues-per-vitaminen-d');

    const aside = page.getByRole('complementary');
    await expect(aside.getByRole('heading', { name: 'Shop this article' })).toBeVisible();
    await aside
      .getByRole('link', { name: /Vitamin D3/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/product\/now-vitamin-d3-4000$/);
  });
});

test.describe('offers (docs/05 §11)', () => {
  test('active codes are claimable and expired ones never render', async ({ page }) => {
    await page.goto('/en/offers');

    /*
     * Scoped to the `<code>` elements, because the seeded offers banner also mentions
     * WELCOME10 in its subtitle — so a bare text match finds two nodes and Playwright's strict
     * mode refuses. What this test is about is the claimable code, not the prose around it.
     */
    const codes = page.locator('code');
    await expect(codes.filter({ hasText: 'WELCOME10' })).toBeVisible();
    await expect(codes.filter({ hasText: 'FALAS' })).toBeVisible();

    /*
     * The acceptance criterion. EXPIRED5 is seeded `is_active = true` with a window that closed
     * in February, precisely so "expired" is tested rather than "inactive" — and SUB-10 is
     * active and hidden, because a system coupon must stay usable by the checkout RPC while
     * never appearing on a page (docs/13 §A3).
     */
    await expect(page.getByText('EXPIRED5')).toHaveCount(0);
    await expect(page.getByText('SUB-10')).toHaveCount(0);
  });
});

test.describe('FAQ (docs/05 §16)', () => {
  test('groups by category, expands, and emits FAQPage JSON-LD', async ({ page }) => {
    await page.goto('/en/faq');

    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();

    const question = page.getByText('Can I pay on delivery?');
    await expect(question).toBeVisible();
    // `<details>` starts closed, so the answer is in the DOM but not visible until it opens.
    await expect(page.getByText('Cash on delivery is the only payment method')).toBeHidden();
    await question.click();
    await expect(page.getByText('Cash on delivery is the only payment method')).toBeVisible();

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.map((block) => (JSON.parse(block) as { '@type': string })['@type']);
    expect(types).toContain('FAQPage');
  });
});

test.describe('contact (docs/05 §16)', () => {
  test('a message reaches the database and is acknowledged', async ({ page }) => {
    const marker = randomUUID().slice(0, 8);
    const email = `e2e-contact-${marker}@biocode.test`;

    await page.goto('/en/contact');
    await page.locator('#contact-name').fill('E2E Sender');
    await page.locator('#contact-email').fill(email);
    await page.locator('#contact-subject').fill(`Subject ${marker}`);
    await page.locator('#contact-body').fill(`This is an end-to-end test message ${marker}.`);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Message sent')).toBeVisible({ timeout: ACTION_TIMEOUT });

    const { data } = await db()
      .from('contact_messages')
      .select('email, subject, status')
      .eq('email', email)
      .maybeSingle();

    const row = data as { subject: string; status: string } | null;
    expect(row, 'the message must be stored').not.toBeNull();
    expect(row?.subject).toBe(`Subject ${marker}`);
    expect(row?.status, 'a new message starts in the queue').toBe('new');

    // docs/05 §16 — the acknowledgement is attempted. With no provider configured it records
    // `skipped_no_provider`, which still proves the send path ran rather than being skipped.
    const { data: logged } = await db()
      .from('email_log')
      .select('template, status')
      .eq('to_email', email)
      .eq('template', 'contact_ack')
      .maybeSingle();

    expect(logged, 'an acknowledgement must be attempted and logged').not.toBeNull();
  });
});

test.describe('newsletter double opt-in (docs/08 §5)', () => {
  test('subscribing writes a pending row and mails a confirmation', async ({ page }) => {
    const email = `e2e-news-${randomUUID().slice(0, 8)}@biocode.test`;

    await page.goto('/en');
    const footer = page.getByRole('contentinfo');
    await footer.locator('input[name="email"]').fill(email);
    await footer.getByRole('button', { name: 'Subscribe' }).click();

    await expect
      .poll(
        async () => {
          const { data } = await db()
            .from('newsletter_subscribers')
            .select('confirmed_at, confirm_token')
            .eq('email', email)
            .maybeSingle();
          return data === null ? null : 'found';
        },
        { message: 'the subscriber row must be written', timeout: ACTION_TIMEOUT },
      )
      .toBe('found');

    const { data: row } = await db()
      .from('newsletter_subscribers')
      .select('confirmed_at, confirm_token, unsubscribe_token')
      .eq('email', email)
      .single();

    const subscriber = row as {
      confirmed_at: string | null;
      confirm_token: string | null;
      unsubscribe_token: string;
    };

    expect(subscriber.confirmed_at, 'double opt-in: not confirmed by subscribing').toBeNull();
    expect(subscriber.confirm_token, 'a confirm token is minted').toBeTruthy();
    // docs/08 §5 — every marketing email needs an unsubscribe link, so the token exists from
    // the first row rather than being minted when the welcome email is sent.
    expect(subscriber.unsubscribe_token, 'an unsubscribe token is minted').toBeTruthy();

    const { data: logged } = await db()
      .from('email_log')
      .select('template')
      .eq('to_email', email)
      .eq('template', 'newsletter_confirm')
      .maybeSingle();
    expect(logged, 'the opt-in email must be attempted').not.toBeNull();

    // ── Confirming ──────────────────────────────────────────────────────────
    await page.goto(`/en/newsletter/confirm?token=${subscriber.confirm_token}`);
    await expect(page.getByRole('heading', { name: 'You are subscribed' })).toBeVisible();

    const { data: confirmed } = await db()
      .from('newsletter_subscribers')
      .select('confirmed_at, confirm_token')
      .eq('email', email)
      .single();

    expect((confirmed as { confirmed_at: string | null }).confirmed_at).not.toBeNull();
    expect(
      (confirmed as { confirm_token: string | null }).confirm_token,
      'the token is spent, so the link cannot be replayed',
    ).toBeNull();

    const { data: welcome } = await db()
      .from('email_log')
      .select('template')
      .eq('to_email', email)
      .eq('template', 'newsletter_welcome')
      .maybeSingle();
    expect(welcome, 'confirming sends the welcome email').not.toBeNull();

    // ── Unsubscribing ───────────────────────────────────────────────────────
    await page.goto(`/en/newsletter/unsubscribe?token=${subscriber.unsubscribe_token}`);
    await expect(page.getByRole('heading', { name: 'You are unsubscribed' })).toBeVisible();

    const { data: gone } = await db()
      .from('newsletter_subscribers')
      .select('unsubscribed_at')
      .eq('email', email)
      .single();
    expect((gone as { unsubscribed_at: string | null }).unsubscribed_at).not.toBeNull();
  });

  test('a bad confirmation token is refused rather than silently accepted', async ({ page }) => {
    await page.goto('/en/newsletter/confirm?token=not-a-real-token');
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  });
});

test.describe('cookie consent (docs/05 §16)', () => {
  test('the banner appears once, and rejecting keeps it away', async ({ page }) => {
    await page.goto('/en');

    const banner = page.getByRole('dialog', { name: 'Cookies' });
    await expect(banner).toBeVisible();

    /*
     * Rejection is a real button of equal weight, not a grey link — the pattern regulators
     * single out. Its position in the DOM before "Accept" is deliberate, and asserted.
     */
    await banner.getByRole('button', { name: 'Only what is needed' }).click();
    await expect(banner).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Cookies' })).toHaveCount(0);
  });
});

test.describe('404 (docs/05 §16)', () => {
  test('offers a search box and the top categories', async ({ page }) => {
    const response = await page.goto('/en/this-page-does-not-exist');
    expect(response?.status()).toBe(404);

    await page.locator('#notfound-search').fill('vitamin');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/en\/search\?q=vitamin$/);
  });
});

test.describe('content accessibility', () => {
  for (const path of [
    '/en/knowledge',
    '/en/knowledge/magnezi-dhe-gjumi',
    '/en/faq',
    '/en/offers',
  ]) {
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
