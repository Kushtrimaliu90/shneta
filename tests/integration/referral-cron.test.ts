import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/17 §3 — what the daily cron runs.
 *
 * The one that matters here is the **true-up**. The monthly sweep does not total the rows whose
 * `loyalty_transaction_id` is null; it pays
 *
 *     sum(referral_earnings.points) − sum(posted referral loyalty_transactions)
 *
 * across everything a referrer has earned. That difference is what makes it self-correcting after a
 * clawback the balance could not fully absorb — and summing unposted rows instead would pay that
 * shortfall twice. Three tests below only make sense against the true-up, and would fail against the
 * naive version, which is the point of having them.
 */

const service = serviceClient();
const userIds: string[] = [];

let admin: TestUser;

async function bareUser(): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    email: `test-${randomUUID()}@biocode.test`,
    password: `Pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  return data.user.id;
}

async function codeOf(id: string): Promise<string> {
  const { data } = await service.from('profiles').select('referral_code').eq('id', id).single();
  return (data as { referral_code: string }).referral_code;
}

/** A link with the clock placed exactly where a test needs it. */
async function link(
  referrerId: string,
  refereeId: string,
  options?: { status?: string; expiresInDays?: number },
): Promise<string> {
  const status = options?.status ?? 'approved';
  const expires = new Date();
  expires.setDate(expires.getDate() + (options?.expiresInDays ?? 365));

  const { data, error } = await service
    .from('referral_links')
    .insert({
      referrer_id: referrerId,
      referee_id: refereeId,
      status,
      source: 'admin',
      code_used: await codeOf(referrerId),
      linked_at: status === 'pending' ? null : new Date().toISOString(),
      expires_at: status === 'pending' ? null : expires.toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`link insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function earning(linkId: string, points: number, reason = 'delivered'): Promise<void> {
  const address = { line1: 'Rr. Test 1', city: 'Prishtinë', country_code: 'XK' };
  const { data: order, error: orderError } = await service
    .from('orders')
    .insert({
      email: `order-${randomUUID()}@biocode.test`,
      phone: '+38344123456',
      subtotal_cents: points * 100,
      total_cents: points * 100,
      shipping_address: address,
      billing_address: address,
    })
    .select('id')
    .single();
  if (orderError || !order) throw new Error(`order insert failed: ${orderError?.message}`);

  const { error } = await service.from('referral_earnings').insert({
    link_id: linkId,
    order_id: (order as { id: string }).id,
    base_cents: points * 100,
    points,
    reason,
  });
  if (error) throw new Error(`earning insert failed: ${error.message}`);
}

async function balanceOf(userId: string): Promise<number> {
  const { data } = await service
    .from('profiles')
    .select('loyalty_points')
    .eq('id', userId)
    .single();
  return (data as { loyalty_points: number }).loyalty_points;
}

async function referralLedger(userId: string) {
  const { data } = await service
    .from('loyalty_transactions')
    .select('points, reason, note, order_id')
    .eq('user_id', userId)
    .in('reason', ['referral', 'referral_clawback'])
    .order('created_at');
  return (data ?? []) as {
    points: number;
    reason: string;
    note: string;
    order_id: string | null;
  }[];
}

async function statusOf(linkId: string): Promise<string> {
  const { data } = await service.from('referral_links').select('status').eq('id', linkId).single();
  return (data as { status: string }).status;
}

beforeAll(async () => {
  admin = await createUser('admin');
  userIds.push(admin.id);
});

afterAll(async () => {
  for (const id of userIds) await deleteUser(id);
});

describe('expiry (docs/17 §1)', () => {
  it('flips an approved link whose twelve months are up', async () => {
    const past = await link(await bareUser(), await bareUser(), { expiresInDays: -1 });
    const future = await link(await bareUser(), await bareUser(), { expiresInDays: 30 });

    const { error } = await service.rpc('expire_referral_links');
    expect(error).toBeNull();

    expect(await statusOf(past)).toBe('expired');
    expect(await statusOf(future)).toBe('approved');
  });

  it('leaves a pending link alone, however old', async () => {
    // A link waiting for review has no clock at all — `expires_at` is null until approval.
    const pending = await link(await bareUser(), await bareUser(), { status: 'pending' });
    await service.rpc('expire_referral_links');
    expect(await statusOf(pending)).toBe('pending');
  });

  it('is closed to a signed-in caller', async () => {
    const { error } = await admin.client.rpc('expire_referral_links');
    // Service-role only: an admin has no reason to reach it, and a customer certainly does not.
    expect(error).not.toBeNull();
  });
});

describe('the monthly true-up (docs/17 §3)', () => {
  it('posts one aggregated row per referrer, not one per order', async () => {
    const referrer = await bareUser();
    const l1 = await link(referrer, await bareUser());
    const l2 = await link(referrer, await bareUser());
    await earning(l1, 40);
    await earning(l1, 25);
    await earning(l2, 35);

    const { data, error } = await service.rpc('post_referral_earnings', { p_period: '2026-07' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ period: '2026-07' });

    const ledger = await referralLedger(referrer);
    // One row, for the total — three rows would be a dated list of when a referred customer shopped.
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.points).toBe(100);
    expect(ledger[0]?.note).toBe('Referral earnings — 2026-07');
    // And still no order id on it (docs/17 §0.2).
    expect(ledger[0]?.order_id).toBeNull();
    expect(await balanceOf(referrer)).toBe(100);
  });

  it('pays nothing the second time it runs', async () => {
    const referrer = await bareUser();
    await earning(await link(referrer, await bareUser()), 70);

    await service.rpc('post_referral_earnings', { p_period: '2026-07' });
    const { data } = await service.rpc('post_referral_earnings', { p_period: '2026-07' });

    expect((data as { referrers: number }).referrers).toBe(0);
    expect(await referralLedger(referrer)).toHaveLength(1);
    expect(await balanceOf(referrer)).toBe(70);
  });

  /*
   * The reason the sweep is a true-up rather than a sum of unposted rows.
   *
   * Run one month, earn more, run again: the second run must pay only the *new* amount. A naive
   * implementation gets this right too — the interesting cases are the two below.
   */
  it('pays only the difference in a later month', async () => {
    const referrer = await bareUser();
    const l = await link(referrer, await bareUser());
    await earning(l, 50);

    await service.rpc('post_referral_earnings', { p_period: '2026-07' });
    expect(await balanceOf(referrer)).toBe(50);

    await earning(l, 30);
    await service.rpc('post_referral_earnings', { p_period: '2026-08' });

    expect(await balanceOf(referrer)).toBe(80);
    const ledger = await referralLedger(referrer);
    expect(ledger.map((row) => row.points)).toEqual([50, 30]);
  });

  /**
   * A refund arriving after the points were paid.
   *
   * The earnings ledger nets to 20; the wallet holds 50. The true-up posts −30 and the two agree. A sum
   * of unposted rows would post −50 (the refund row) and leave the wallet at 0, which is wrong by the
   * 20 the referrer legitimately kept.
   */
  it('corrects itself when a clawback lands after posting', async () => {
    const referrer = await bareUser();
    const l = await link(referrer, await bareUser());
    await earning(l, 50);
    await service.rpc('post_referral_earnings', { p_period: '2026-07' });
    expect(await balanceOf(referrer)).toBe(50);

    await earning(l, -30, 'refund');
    await service.rpc('post_referral_earnings', { p_period: '2026-08' });

    expect(await balanceOf(referrer)).toBe(20);
    const ledger = await referralLedger(referrer);
    expect(ledger.map((row) => [row.points, row.reason])).toEqual([
      [50, 'referral'],
      [-30, 'referral_clawback'],
    ]);
  });

  /**
   * And the case that gives the true-up its name.
   *
   * The referrer spends the points before the refund lands, so the clawback can only take what is
   * there. The shortfall stays visible as the gap between the two ledgers — and the *next* month's
   * earnings are reduced by it automatically, because the sweep always pays the difference rather than
   * the month's total.
   */
  it('nets an unrecovered shortfall against later earnings', async () => {
    const referrer = await bareUser();
    const l = await link(referrer, await bareUser());
    await earning(l, 50);
    await service.rpc('post_referral_earnings', { p_period: '2026-07' });

    // Spent, so only 10 remain to claw back from.
    await service
      .from('loyalty_transactions')
      .insert({ user_id: referrer, points: -40, reason: 'redeem', note: 'spent it' });
    expect(await balanceOf(referrer)).toBe(10);

    await earning(l, -50, 'refund');
    await service.rpc('post_referral_earnings', { p_period: '2026-08' });

    // Owed −50 against a balance of 10: floored, so 10 comes back and 40 is still outstanding.
    expect(await balanceOf(referrer)).toBe(0);

    /*
     * Now they earn 60. Earnings net to 60 − 50 + 50 = 60… but only 10 of the clawback was recovered,
     * so the wallet has received 50 − 10 = 40. The difference is 60 − 40 = 20, and that is what posts.
     */
    await earning(l, 60);
    await service.rpc('post_referral_earnings', { p_period: '2026-09' });
    expect(await balanceOf(referrer)).toBe(20);
  });

  it('is closed to a signed-in caller', async () => {
    const { error } = await admin.client.rpc('post_referral_earnings', { p_period: '2026-07' });
    expect(error).not.toBeNull();
  });
});

describe('auto-approve (docs/17 §1)', () => {
  async function withSetting<T>(patch: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const { data } = await service.from('settings').select('value').eq('key', 'referral').single();
    const original = (data as { value: Record<string, unknown> }).value;
    try {
      await service
        .from('settings')
        .update({ value: { ...original, ...patch } })
        .eq('key', 'referral');
      return await run();
    } finally {
      await service.from('settings').update({ value: original }).eq('key', 'referral');
    }
  }

  /** A referee with a delivered order — the thing auto-approval waits for. */
  async function refereeWhoOrdered(): Promise<string> {
    const id = await bareUser();
    const address = { line1: 'Rr. Test 1', city: 'Prishtinë', country_code: 'XK' };
    const { data, error } = await service
      .from('orders')
      .insert({
        user_id: id,
        email: `order-${randomUUID()}@biocode.test`,
        phone: '+38344123456',
        subtotal_cents: 5000,
        total_cents: 5000,
        shipping_address: address,
        billing_address: address,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`order insert failed: ${error?.message}`);

    for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
      await service
        .from('orders')
        .update({ status })
        .eq('id', (data as { id: string }).id);
    }
    return id;
  }

  it('does nothing while the setting is off', async () => {
    const pending = await link(await bareUser(), await refereeWhoOrdered(), { status: 'pending' });
    // Off is the launch setting (docs/17 §1) — every link waits for a person.
    const { data } = await service.rpc('auto_approve_referral_links');
    expect(data).toBe(0);
    expect(await statusOf(pending)).toBe('pending');
  });

  it('approves a flag-free link once the referee has a delivered order', async () => {
    await withSetting({ auto_approve: true }, async () => {
      const ready = await link(await bareUser(), await refereeWhoOrdered(), { status: 'pending' });
      const notYet = await link(await bareUser(), await bareUser(), { status: 'pending' });

      const { error } = await service.rpc('auto_approve_referral_links');
      expect(error).toBeNull();

      expect(await statusOf(ready)).toBe('approved');
      // No delivered order, so nothing to go on — this is exactly what the queue is for.
      expect(await statusOf(notYet)).toBe('pending');
    });
  });

  /*
   * The important restraint. Risk flags exist to put a link in front of a person, so a switch that
   * approved past them would make the fraud panel decorative.
   */
  it('never auto-approves a flagged link', async () => {
    await withSetting({ auto_approve: true }, async () => {
      const flagged = await link(await bareUser(), await refereeWhoOrdered(), {
        status: 'pending',
      });
      await service
        .from('referral_links')
        .update({ risk_flags: ['same_address'] })
        .eq('id', flagged);

      await service.rpc('auto_approve_referral_links');
      expect(await statusOf(flagged)).toBe('pending');
    });
  });

  it('does nothing while the whole programme is off', async () => {
    await withSetting({ enabled: false, auto_approve: true }, async () => {
      const pending = await link(await bareUser(), await refereeWhoOrdered(), {
        status: 'pending',
      });
      const { data } = await service.rpc('auto_approve_referral_links');
      expect(data).toBe(0);
      expect(await statusOf(pending)).toBe('pending');
    });
  });
});

describe('the expiry notice window (docs/17 §7)', () => {
  /*
   * One day wide, and that is the whole design. "Expires within 30 days" would match every day from
   * T−30 to T−0 and email the same referrer thirty times.
   */
  it('matches only the day that is exactly N days away', async () => {
    const referrer = await bareUser();
    const exact = await link(referrer, await bareUser(), { expiresInDays: 30 });
    const dayBefore = await link(await bareUser(), await bareUser(), { expiresInDays: 29 });
    const dayAfter = await link(await bareUser(), await bareUser(), { expiresInDays: 31 });

    const { data, error } = await service.rpc('referral_links_expiring', { p_days: 30 });
    expect(error).toBeNull();

    const ids = ((data ?? []) as { link_id: string }[]).map((row) => row.link_id);
    expect(ids).toContain(exact);
    /*
     * Asserted by exclusion rather than by counting.
     *
     * `toHaveLength(1)` looked tighter and was wrong: the expiry test at the top of this file also
     * creates a link 30 days out, so the count depends on which tests ran first — a fixture leak
     * masquerading as a bug in the window. What the window actually promises is that the neighbouring
     * days are not in it.
     */
    expect(ids).not.toContain(dayBefore);
    expect(ids).not.toContain(dayAfter);
  });

  it('carries what the email needs and nothing about the referee', async () => {
    const referrer = await bareUser();
    const l = await link(referrer, await bareUser(), { expiresInDays: 7 });
    await earning(l, 42);

    const { data } = await service.rpc('referral_links_expiring', { p_days: 7 });
    const row = ((data ?? []) as Record<string, unknown>[]).find((r) => r.link_id === l);

    expect(row).toBeDefined();
    expect(Number(row?.points_earned)).toBe(42);

    /*
     * The privacy assertion: the row the email is built from must not mention the referred customer.
     * Everything here is about the referrer and the clock.
     */
    const forbidden = /referee|spend|order|amount|total/i;
    for (const key of Object.keys(row ?? {})) expect(key).not.toMatch(forbidden);
  });

  it('skips a link that is not running', async () => {
    const revoked = await link(await bareUser(), await bareUser(), { expiresInDays: 7 });
    await service.from('referral_links').update({ status: 'revoked' }).eq('id', revoked);

    const { data } = await service.rpc('referral_links_expiring', { p_days: 7 });
    const ids = ((data ?? []) as { link_id: string }[]).map((row) => row.link_id);
    expect(ids).not.toContain(revoked);
  });
});

describe('the event-email sweep (docs/17 §7)', () => {
  /*
   * The sweep exists because the four event emails are triggered from four places, one of which is a SQL
   * trigger that cannot send mail. So the state change leaves a mark and the cron sends — and these tests
   * are about the mark, because the sending is fire-and-forget by design.
   */
  it('offers a new link once, for both parties, then never again', async () => {
    const referrer = await bareUser();
    const referee = await bareUser();
    await service.from('profiles').update({ full_name: 'Blerim Krasniqi' }).eq('id', referrer);
    await service.from('profiles').update({ full_name: 'Arta Berisha' }).eq('id', referee);
    const l = await link(referrer, referee, { status: 'pending' });

    const { data, error } = await service.rpc('referral_links_needing_email', { p_kind: 'joined' });
    expect(error).toBeNull();

    const row = ((data ?? []) as Record<string, unknown>[]).find((r) => r.link_id === l);
    expect(row).toBeDefined();
    // Both sides come from one row, so the two halves of one event cannot drift apart.
    expect(row?.referee_masked_name).toBe('Arta B.');
    expect(row?.referrer_masked_name).toBe('Blerim K.');

    await service.rpc('mark_referral_emailed', { p_link_id: l, p_kind: 'joined' });

    const second = await service.rpc('referral_links_needing_email', { p_kind: 'joined' });
    const ids = ((second.data ?? []) as { link_id: string }[]).map((r) => r.link_id);
    expect(ids).not.toContain(l);
  });

  it('never sends the surname, only the initial', async () => {
    const referee = await bareUser();
    await service.from('profiles').update({ full_name: 'Arta Berisha' }).eq('id', referee);
    const l = await link(await bareUser(), referee, { status: 'pending' });

    const { data } = await service.rpc('referral_links_needing_email', { p_kind: 'joined' });
    const row = ((data ?? []) as Record<string, unknown>[]).find((r) => r.link_id === l);

    expect(String(row?.referee_masked_name)).not.toContain('Berisha');
    /*
     * And nothing about what they bought. The email is built from exactly these columns, so an amount or
     * an order number here would end up in a referrer's inbox (docs/17 §0.2).
     */
    const forbidden = /spend|amount|order|total|points|cents/i;
    for (const key of Object.keys(row ?? {})) expect(key).not.toMatch(forbidden);
  });

  it('keeps the three kinds on separate flags', async () => {
    const l = await link(await bareUser(), await bareUser());

    // Stamped as `joined`, so it is still owed the `approved` email.
    await service.rpc('mark_referral_emailed', { p_link_id: l, p_kind: 'joined' });

    const approved = await service.rpc('referral_links_needing_email', { p_kind: 'approved' });
    const ids = ((approved.data ?? []) as { link_id: string }[]).map((r) => r.link_id);
    expect(ids).toContain(l);
  });

  it('only offers `revoked` for a link somebody actually stopped', async () => {
    const revoked = await link(await bareUser(), await bareUser());
    await service.from('referral_links').update({ status: 'revoked' }).eq('id', revoked);

    // Expired is not revoked: it gets the T−7 notice instead, and saying both would be telling somebody
    // twice that the same thing ended.
    const expired = await link(await bareUser(), await bareUser());
    await service.from('referral_links').update({ status: 'expired' }).eq('id', expired);

    const { data } = await service.rpc('referral_links_needing_email', { p_kind: 'revoked' });
    const ids = ((data ?? []) as { link_id: string }[]).map((r) => r.link_id);
    expect(ids).toContain(revoked);
    expect(ids).not.toContain(expired);
  });

  it('refuses a kind it does not know, rather than returning everything', async () => {
    const { error } = await service.rpc('referral_links_needing_email', { p_kind: 'whatever' });
    expect(error?.message).toContain('UNKNOWN_EMAIL_KIND');
  });

  it('is closed to a signed-in caller', async () => {
    const listed = await admin.client.rpc('referral_links_needing_email', { p_kind: 'joined' });
    expect(listed.error).not.toBeNull();

    const marked = await admin.client.rpc('mark_referral_emailed', {
      p_link_id: await link(await bareUser(), await bareUser()),
      p_kind: 'joined',
    });
    expect(marked.error).not.toBeNull();
  });
});

describe('mask_person_name (docs/17 §6)', () => {
  /*
   * Extracted into one function because three places build this label, and three copies of a masking rule
   * is three chances for one of them to be generous. These are the cases that made it worth extracting.
   */
  it.each([
    ['Arta Berisha', 'Arta B.'],
    ['arta berisha', 'arta B.'],
    ['Arta', 'Arta'],
    ['  Arta   Berisha  ', 'Arta B.'],
    ['Arta Berisha Krasniqi', 'Arta B.'],
    ['', 'një klient'],
    ['   ', 'një klient'],
  ])('%s → %s', async (input, expected) => {
    const { data } = await service.rpc('mask_person_name', { p_full_name: input });
    expect(data).toBe(expected);
  });

  it('falls back to a label rather than an email local part for a nameless account', async () => {
    // The fallback matters: an email local part is an identifier, and a generic word is not.
    const { data } = await service.rpc('mask_person_name', { p_full_name: null });
    expect(data).toBe('një klient');
  });
});

describe('runReferralCron — the TypeScript engine (docs/17 §3)', () => {
  /*
   * Everything above tests the SQL. This tests the module that calls it, because an engine nobody has
   * run is an engine nobody knows works: the RPC names are strings, the summary is assembled by hand, and
   * `isPostingDay` gates a third of the passes behind a date nobody hits by accident.
   *
   * Importable here and not from the unit suite because it starts with `import 'server-only'` — the
   * integration config stubs that module deliberately (docs/13 §X5), and this is exactly the case the
   * stub exists for.
   *
   * The emails are real calls. Every fixture address ends in `@biocode.test`, which
   * `isUndeliverableRecipient` refuses before the provider is touched (RFC 6761), so the send path
   * executes end to end and nothing leaves the machine.
   */
  it('runs every pass and reports what it did', async () => {
    const { runReferralCron } = await import('@/features/referrals/engine');

    // Something for each pass to find: a link past its clock, and one owed a `joined` email.
    const stale = await link(await bareUser(), await bareUser(), { expiresInDays: -1 });
    const fresh = await link(await bareUser(), await bareUser(), { status: 'pending' });

    // The 1st, so the posting pass runs — on any other date it is skipped by design.
    const summary = await runReferralCron(new Date(Date.UTC(2026, 8, 1, 4, 45)));

    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(stale)).toBe('expired');

    // Posting ran, and named the month that had just finished rather than the current one.
    expect(summary.posted?.period).toBe('2026-08');

    /*
     * The `joined` sweep sent two messages for the new link — the referrer's and the referee's welcome —
     * and stamped it, so a second run must not send them again.
     */
    expect(summary.eventEmailsSent).toBeGreaterThanOrEqual(2);

    const second = await runReferralCron(new Date(Date.UTC(2026, 8, 1, 4, 45)));
    expect(second.posted?.referrers).toBe(0);

    const { data } = await service
      .from('referral_links')
      .select('joined_email_at')
      .eq('id', fresh)
      .single();
    expect((data as { joined_email_at: string | null }).joined_email_at).not.toBeNull();
  });

  it('skips the posting pass on any day but the 1st', async () => {
    const { runReferralCron } = await import('@/features/referrals/engine');

    const summary = await runReferralCron(new Date(Date.UTC(2026, 8, 17, 4, 45)));

    /*
     * Restricted to the 1st by choice, not by safety: the true-up is arithmetically safe to run daily,
     * and running it daily would write one ledger row per referrer per day — the purchase timeline
     * docs/17 §0.2 exists to avoid publishing to the referrer.
     */
    expect(summary.posted).toBeNull();
    expect(summary.summariesSent).toBe(0);
  });

  it('records the sends in email_log rather than dropping them', async () => {
    const { runReferralCron } = await import('@/features/referrals/engine');

    await link(await bareUser(), await bareUser(), { status: 'pending' });
    await runReferralCron(new Date(Date.UTC(2026, 8, 17, 4, 45)));

    /*
     * A `.test` recipient is skipped before the provider, and **logged** — dropping it would break every
     * assertion that an email "was sent" while hiding the reason (docs/13, `lib/email/recipients.ts`).
     */
    const { data } = await service
      .from('email_log')
      .select('template, status')
      .in('template', ['referral_joined', 'referral_welcome'])
      .order('created_at', { ascending: false })
      .limit(4);

    const templates = ((data ?? []) as { template: string }[]).map((row) => row.template);
    expect(templates).toContain('referral_joined');
    expect(templates).toContain('referral_welcome');
  });
});
