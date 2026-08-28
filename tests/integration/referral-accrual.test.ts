import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/17 §1, §3 — the accrual engine.
 *
 * ── Why the arithmetic is tested here and not in a unit test ──
 *
 * docs/17 §9 files "points math at boundaries" under Unit. It is not: the arithmetic lives in
 * `accrue_referral_for_order`, in plpgsql, and a TypeScript re-implementation of it would prove only
 * that two functions agree — while the one that actually pays people goes unexercised. plpgsql also
 * defers validating a function body until first execution (docs/13 §X1), so a test that never runs the
 * refund branch has not established that the refund branch compiles.
 *
 * ── Orders are inserted, not bought ──
 *
 * `checkout_create_order` needs the customer's own JWT, so every order placed through it costs a
 * `signInWithPassword` — and Supabase rate-limits those per IP hard enough to fail unrelated files
 * (docs/13 §Y4). The engine reads five columns off `orders` and nothing else, so the fixtures write
 * those columns directly and walk the status machine. One signed-in account exists in this file, for
 * the one assertion that has to travel through RLS.
 */

const service = serviceClient();
const userIds: string[] = [];

/** Referral config, restored after any test that changes it. */
async function referralConfig(): Promise<Record<string, unknown>> {
  const { data } = await service.from('settings').select('value').eq('key', 'referral').single();
  return (data as { value: Record<string, unknown> }).value;
}

async function setReferralConfig(value: Record<string, unknown>): Promise<void> {
  const { error } = await service.from('settings').update({ value }).eq('key', 'referral');
  if (error) throw new Error(`settings update failed: ${error.message}`);
}

/** A confirmed account with no sign-in. */
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

interface LinkOptions {
  status?: string;
  /** Months from now until the clock stops. Negative puts the link already past its end. */
  expiresInMonths?: number;
}

async function link(referrerId: string, refereeId: string, options?: LinkOptions): Promise<string> {
  const status = options?.status ?? 'approved';
  const expires = new Date();
  expires.setMonth(expires.getMonth() + (options?.expiresInMonths ?? 12));

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

interface OrderOptions {
  subtotalCents: number;
  discountCents?: number;
  shippingCents?: number;
}

/** An order with the money set exactly, so a boundary can be aimed at rather than approximated. */
async function order(userId: string | null, options: OrderOptions): Promise<string> {
  const discount = options.discountCents ?? 0;
  const shipping = options.shippingCents ?? 0;
  const address = { line1: 'Rr. Test 1', city: 'Prishtinë', country_code: 'XK' };

  const { data, error } = await service
    .from('orders')
    .insert({
      user_id: userId,
      email: `order-${randomUUID()}@biocode.test`,
      phone: '+38344123456',
      subtotal_cents: options.subtotalCents,
      discount_cents: discount,
      shipping_cents: shipping,
      total_cents: options.subtotalCents - discount + shipping,
      shipping_address: address,
      billing_address: address,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`order insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

/** Walks the state machine to `delivered`, which is what fires the accrual. */
async function deliver(orderId: string): Promise<void> {
  for (const status of ['confirmed', 'processing', 'shipped', 'delivered']) {
    const { error } = await service.from('orders').update({ status }).eq('id', orderId);
    if (error) throw new Error(`transition to ${status} failed: ${error.message}`);
  }
}

async function refund(orderId: string, amountCents: number): Promise<void> {
  const { error } = await service
    .from('refunds')
    .insert({ order_id: orderId, amount_cents: amountCents, reason: 'test' });
  if (error) throw new Error(`refund insert failed: ${error.message}`);
}

async function earnings(orderId: string) {
  const { data } = await service
    .from('referral_earnings')
    .select('base_cents, points, reason, loyalty_transaction_id')
    .eq('order_id', orderId)
    .order('reason');
  return (data ?? []) as {
    base_cents: number;
    points: number;
    reason: string;
    loyalty_transaction_id: string | null;
  }[];
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
    .select('points, reason, order_id, note')
    .eq('user_id', userId)
    .in('reason', ['referral', 'referral_clawback'])
    .order('created_at');
  return (data ?? []) as { points: number; reason: string; order_id: string | null }[];
}

/** A referrer and a referee with an approved link between them, ready to earn. */
async function pair(options?: LinkOptions): Promise<{ referrer: string; referee: string }> {
  const referrer = await bareUser();
  const referee = await bareUser();
  await link(referrer, referee, options);
  return { referrer, referee };
}

let original: Record<string, unknown>;

beforeAll(async () => {
  original = await referralConfig();
});

afterAll(async () => {
  await setReferralConfig(original);
  for (const id of userIds) await deleteUser(id);
});

describe('what a referral is worth (docs/17 §1)', () => {
  /** The headline number in the spec, and the one a customer will check. */
  it('pays exactly 100 points for €100 of eligible spend', async () => {
    const { referrer, referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000 });
    await deliver(id);

    expect(await earnings(id)).toEqual([
      { base_cents: 10_000, points: 100, reason: 'delivered', loyalty_transaction_id: null },
    ]);
    // 100 points × 1 cent = €1, which is the 1% the terms page states.
    expect(referrer).toBeTruthy();
  });

  it('excludes shipping from the base', async () => {
    const { referee } = await pair();
    // €100 of product plus a €2.50 courier fee. The courier is not the referrer's business.
    const id = await order(referee, { subtotalCents: 10_000, shippingCents: 250 });
    await deliver(id);

    expect((await earnings(id))[0]?.base_cents).toBe(10_000);
    expect((await earnings(id))[0]?.points).toBe(100);
  });

  it('subtracts a discount before paying on it', async () => {
    const { referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000, discountCents: 2_000 });
    await deliver(id);

    expect((await earnings(id))[0]).toMatchObject({ base_cents: 8_000, points: 80 });
  });

  it('rounds down rather than up', async () => {
    const { referee } = await pair();
    // €150.99 → 150.99 points → 150. The shop keeps the fraction; nobody is paid a part of a point.
    const id = await order(referee, { subtotalCents: 15_099 });
    await deliver(id);

    expect((await earnings(id))[0]?.points).toBe(150);
  });

  it('ignores an order below the minimum', async () => {
    const { referee } = await pair();
    // €9.99, a cent under `min_order_cents_to_count`.
    const id = await order(referee, { subtotalCents: 999 });
    await deliver(id);

    expect(await earnings(id)).toEqual([]);
  });

  it('counts an order exactly on the minimum', async () => {
    const { referee } = await pair();
    const id = await order(referee, { subtotalCents: 1_000 });
    await deliver(id);

    expect((await earnings(id))[0]?.points).toBe(10);
  });
});

describe('what does not accrue (docs/17 §3)', () => {
  it('a guest order, because there is no account to link', async () => {
    const id = await order(null, { subtotalCents: 10_000 });
    await deliver(id);
    expect(await earnings(id)).toEqual([]);
  });

  it('an order from a customer with no referrer', async () => {
    const id = await order(await bareUser(), { subtotalCents: 10_000 });
    await deliver(id);
    expect(await earnings(id)).toEqual([]);
  });

  it('a link still waiting for approval', async () => {
    const { referee } = await pair({ status: 'pending' });
    const id = await order(referee, { subtotalCents: 10_000 });
    await deliver(id);
    expect(await earnings(id)).toEqual([]);
  });

  /** Revocation is immediate, and it takes nothing back (docs/17 §1). */
  it('a revoked link — while the points it already earned stay put', async () => {
    const { referrer, referee } = await pair();

    const first = await order(referee, { subtotalCents: 10_000 });
    await deliver(first);
    expect((await earnings(first))[0]?.points).toBe(100);

    await service
      .from('referral_links')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('referee_id', referee);

    const second = await order(referee, { subtotalCents: 10_000 });
    await deliver(second);

    expect(await earnings(second)).toEqual([]);
    // The first earning is untouched: stopping future accrual is not the same as taking money back.
    expect((await earnings(first))[0]?.points).toBe(100);
    expect(referrer).toBeTruthy();
  });

  it('an order delivered after the twelve months are up', async () => {
    const { referee } = await pair({ expiresInMonths: -1 });
    const id = await order(referee, { subtotalCents: 10_000 });
    await deliver(id);
    expect(await earnings(id)).toEqual([]);
  });

  it('nothing at all while the programme is switched off', async () => {
    const { referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000 });

    try {
      await setReferralConfig({ ...original, enabled: false });
      await deliver(id);
      expect(await earnings(id)).toEqual([]);
    } finally {
      await setReferralConfig(original);
    }
  });
});

describe('idempotency (docs/17 §3)', () => {
  /*
   * The unique `(order_id, reason)` is the guarantee, and this is the test that says so. The engine
   * inserts the earning row *before* moving the wallet, precisely so that a second concurrent call
   * loses the conflict and never posts — an earlier version posted first and deleted on conflict, which
   * is the same race with extra steps.
   */
  it('a second delivered call adds nothing', async () => {
    const { referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000 });
    await deliver(id);

    const again = await service.rpc('accrue_referral_for_order', {
      p_order_id: id,
      p_reason: 'delivered',
    });
    expect(again.error).toBeNull();
    expect(again.data).toBe(0);
    expect(await earnings(id)).toHaveLength(1);
  });

  it('ten simultaneous calls produce one earning', async () => {
    const { referrer, referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000 });

    try {
      // `immediate`, so a duplicate would show up in the wallet as well as in the ledger.
      await setReferralConfig({ ...original, accrual_mode: 'immediate' });

      await Promise.all(
        Array.from({ length: 10 }, () =>
          service.rpc('accrue_referral_for_order', { p_order_id: id, p_reason: 'delivered' }),
        ),
      );

      expect(await earnings(id)).toHaveLength(1);
      expect(await referralLedger(referrer)).toHaveLength(1);
      expect(await balanceOf(referrer)).toBe(100);
    } finally {
      await setReferralConfig(original);
    }
  });
});

describe('clawback (docs/17 §1)', () => {
  it('a full refund takes all of it back', async () => {
    const { referrer, referee } = await pair();

    try {
      await setReferralConfig({ ...original, accrual_mode: 'immediate' });
      const id = await order(referee, { subtotalCents: 10_000 });
      await deliver(id);
      expect(await balanceOf(referrer)).toBe(100);

      await refund(id, 10_000);

      const rows = await earnings(id);
      expect(rows.find((r) => r.reason === 'refund')?.points).toBe(-100);
      expect(await balanceOf(referrer)).toBe(0);
    } finally {
      await setReferralConfig(original);
    }
  });

  it('a partial refund takes back its share, and a second one takes the rest', async () => {
    const { referrer, referee } = await pair();

    try {
      await setReferralConfig({ ...original, accrual_mode: 'immediate' });
      const id = await order(referee, { subtotalCents: 10_000 });
      await deliver(id);
      expect(await balanceOf(referrer)).toBe(100);

      // Half the order back: half the points.
      await refund(id, 5_000);
      expect(await balanceOf(referrer)).toBe(50);

      /*
       * The second half. This is the case a naive `on conflict do nothing` gets wrong — one refund row
       * per order means the second refund would reclaim nothing at all, so the row carries the running
       * total and only the difference is posted.
       */
      await refund(id, 5_000);
      expect(await balanceOf(referrer)).toBe(0);

      const rows = await earnings(id);
      expect(rows.filter((r) => r.reason === 'refund')).toHaveLength(1);
      expect(rows.find((r) => r.reason === 'refund')?.points).toBe(-100);
    } finally {
      await setReferralConfig(original);
    }
  });

  it('never drives a balance below zero', async () => {
    const { referrer, referee } = await pair();

    try {
      await setReferralConfig({ ...original, accrual_mode: 'immediate' });
      const id = await order(referee, { subtotalCents: 10_000 });
      await deliver(id);

      // The referrer spends most of it before the refund lands.
      await service
        .from('loyalty_transactions')
        .insert({ user_id: referrer, points: -80, reason: 'redeem', note: 'spent it' });
      expect(await balanceOf(referrer)).toBe(20);

      await refund(id, 10_000);

      /*
       * Floored at the balance, not at zero-minus-the-difference. `sync_loyalty_balance` clamps the
       * balance at zero, so posting -100 against 20 would leave the balance at 0 and the ledger summing
       * to -80: a ledger that disagrees with the balance is worse than an under-recovered clawback.
       */
      expect(await balanceOf(referrer)).toBe(0);

      const posted = await referralLedger(referrer);
      expect(posted.find((row) => row.reason === 'referral_clawback')?.points).toBe(-20);
      // The full amount owed is still recorded on the earning, which is where the shortfall shows.
      expect((await earnings(id)).find((r) => r.reason === 'refund')?.points).toBe(-100);
    } finally {
      await setReferralConfig(original);
    }
  });

  it('under monthly posting, a refund before the sweep simply nets to nothing', async () => {
    const { referrer, referee } = await pair();
    const id = await order(referee, { subtotalCents: 10_000 });
    await deliver(id);
    await refund(id, 10_000);

    // Neither row was posted, so the wallet never moved — which is kinder than paying and reclaiming.
    const rows = await earnings(id);
    expect(rows.map((r) => [r.reason, r.points, r.loyalty_transaction_id])).toEqual([
      ['delivered', 100, null],
      ['refund', -100, null],
    ]);
    expect(await balanceOf(referrer)).toBe(0);
    expect(await referralLedger(referrer)).toEqual([]);
  });

  it('a refund on an order that never earned does nothing', async () => {
    const { referee } = await pair();
    const id = await order(referee, { subtotalCents: 999 });
    await deliver(id);
    await refund(id, 999);
    expect(await earnings(id)).toEqual([]);
  });
});

describe('the yearly cap (docs/17 §1)', () => {
  /*
   * Pays up to the cap and flags the link, rather than dropping the overflow silently. Both halves
   * matter: the first part is money the referrer earned, and the flag is what puts a link that reached
   * €200 in twelve months in front of a person — very good advocate, or a farm.
   */
  it('pays up to the limit, then flags the link for review', async () => {
    const { referrer, referee } = await pair();

    try {
      await setReferralConfig({ ...original, max_points_per_link_per_year: 120 });

      const first = await order(referee, { subtotalCents: 10_000 });
      await deliver(first);
      expect((await earnings(first))[0]?.points).toBe(100);

      const second = await order(referee, { subtotalCents: 10_000 });
      await deliver(second);
      // 20 of the 100 remained under the cap.
      expect((await earnings(second))[0]?.points).toBe(20);

      const { data } = await service
        .from('referral_links')
        .select('risk_flags')
        .eq('referee_id', referee)
        .single();
      expect((data as { risk_flags: string[] }).risk_flags).toContain('cap_reached');

      // And once it is spent, nothing more accrues at all.
      const third = await order(referee, { subtotalCents: 10_000 });
      await deliver(third);
      expect(await earnings(third)).toEqual([]);
      expect(referrer).toBeTruthy();
    } finally {
      await setReferralConfig(original);
    }
  });
});

describe('what the referrer can see of it (docs/17 §0.2)', () => {
  /*
   * The one assertion in this file that travels through RLS, and the reason it exists: the ledger row a
   * referrer *can* read must not date a referred customer's shopping.
   *
   * `loyalty_transactions.order_id` is deliberately null on referral rows. The order lives on
   * `referral_earnings`, which has no customer policy at all — so there is no join from the row the
   * referrer can see to the order that caused it.
   */
  it('a referral ledger row names no order', async () => {
    const referrer: TestUser = await createUser('customer');
    userIds.push(referrer.id);
    const referee = await bareUser();
    await link(referrer.id, referee);

    try {
      await setReferralConfig({ ...original, accrual_mode: 'immediate' });
      const id = await order(referee, { subtotalCents: 10_000 });
      await deliver(id);

      const { data, error } = await referrer.client
        .from('loyalty_transactions')
        .select('points, reason, order_id')
        .eq('reason', 'referral');

      expect(error).toBeNull();
      expect(data).toEqual([{ points: 100, reason: 'referral', order_id: null }]);

      // And the earnings table itself is unreachable, which is the stronger half.
      const direct = await referrer.client.from('referral_earnings').select('id');
      expect(direct.data ?? []).toEqual([]);
    } finally {
      await setReferralConfig(original);
    }
  });
});
