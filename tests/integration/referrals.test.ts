import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/17 §1, §6 — the referral foundation: codes, the one-referrer rule, and the privacy boundary.
 *
 * ── What this file is really for ──
 *
 * §0.2 admits a limit that cannot be engineered away: a referrer with exactly one active referral can
 * multiply its own points by 100 and read that person's spend. Everything else about the design exists
 * to stop the *shape* of the data making it worse — and "everything else" is a set of absences, which
 * is precisely what nobody notices breaking.
 *
 * There is no policy letting a referrer select `referral_links`. There is no customer policy on
 * `referral_earnings` at all. The RPC returns a join **month** and `days_left` rather than dates. None
 * of that produces a failing test when somebody helpfully adds a policy or a field — unless the test
 * asserts the absence directly, which is what the shape assertion below does.
 */

const userIds: string[] = [];
let referrer: TestUser;
let referee: TestUser;
let outsider: TestUser;
let staff: TestUser;

/** The masked label is built from `full_name`, so the fixtures need real ones. */
async function setName(id: string, name: string): Promise<void> {
  const { error } = await serviceClient().from('profiles').update({ full_name: name }).eq('id', id);
  if (error) throw new Error(`could not set name: ${error.message}`);
}

async function codeOf(id: string): Promise<string> {
  const { data } = await serviceClient()
    .from('profiles')
    .select('referral_code')
    .eq('id', id)
    .single();
  return (data as { referral_code: string }).referral_code;
}

/** An approved link, which is the only status that accrues. */
async function link(
  referrerId: string,
  refereeId: string,
  fields?: { status?: string; monthsAgo?: number; expiresInDays?: number },
): Promise<string> {
  const monthsAgo = fields?.monthsAgo ?? 0;
  const linkedAt = new Date();
  linkedAt.setMonth(linkedAt.getMonth() - monthsAgo);

  const expires = new Date(linkedAt);
  if (fields?.expiresInDays === undefined) expires.setMonth(expires.getMonth() + 12);
  else expires.setDate(new Date().getDate() + fields.expiresInDays);

  const status = fields?.status ?? 'approved';
  const decided = status === 'approved' || status === 'revoked' || status === 'expired';

  const { data, error } = await serviceClient()
    .from('referral_links')
    .insert({
      referrer_id: referrerId,
      referee_id: refereeId,
      status,
      code_used: await codeOf(referrerId),
      linked_at: decided ? linkedAt.toISOString() : null,
      expires_at: decided ? expires.toISOString() : null,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`link insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

beforeAll(async () => {
  referrer = await createUser('customer');
  referee = await createUser('customer');
  outsider = await createUser('customer');
  staff = await createUser('admin');
  userIds.push(referrer.id, referee.id, outsider.id, staff.id);

  await setName(referrer.id, 'Blerim Krasniqi');
  await setName(referee.id, 'Arta Berisha');
  await setName(outsider.id, 'Driton Gashi');
});

afterAll(async () => {
  // `referral_links` cascades from `profiles`, and `referral_earnings` from the link.
  for (const id of userIds) await deleteUser(id);
});

describe('the referral code (docs/17 §1)', () => {
  it('is issued to every profile, on the unambiguous alphabet', async () => {
    const code = await codeOf(referrer.id);
    expect(code).toMatch(/^BIO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });

  /** A code read aloud in a shop and typed back in lower case has to work. */
  it('matches case-insensitively', async () => {
    const code = await codeOf(referrer.id);
    const { data } = await serviceClient()
      .from('profiles')
      .select('id')
      .eq('referral_code', code.toLowerCase())
      .maybeSingle();

    expect((data as { id: string } | null)?.id).toBe(referrer.id);
  });

  it('is unique across profiles', async () => {
    const { data } = await serviceClient().from('profiles').select('referral_code');
    const codes = ((data ?? []) as { referral_code: string | null }[])
      .map((row) => row.referral_code)
      .filter((code): code is string => Boolean(code));

    expect(new Set(codes.map((c) => c.toLowerCase())).size).toBe(codes.length);
  });

  it('the generator returns a free code', async () => {
    const { data, error } = await serviceClient().rpc('generate_referral_code');
    expect(error).toBeNull();
    expect(String(data)).toMatch(/^BIO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });
});

describe('one referrer per customer, for ever (docs/17 §1)', () => {
  it('a second link for the same referee is refused by the database', async () => {
    const a = await createUser('customer');
    const b = await createUser('customer');
    const c = await createUser('customer');
    userIds.push(a.id, b.id, c.id);

    await link(a.id, b.id);

    const { error } = await serviceClient().from('referral_links').insert({
      referrer_id: c.id,
      referee_id: b.id,
      status: 'pending',
    });

    /*
     * A unique violation, not an application check. The rule has to hold under two concurrent signups
     * typing two different codes, and only the database can promise that.
     */
    expect(error?.code, error?.message).toBe('23505');
  });

  it('a referrer may have many referees', async () => {
    const r = await createUser('customer');
    const one = await createUser('customer');
    const two = await createUser('customer');
    userIds.push(r.id, one.id, two.id);

    await link(r.id, one.id);
    const second = await link(r.id, two.id);

    expect(second).toBeTruthy();
  });

  it('self-referral is refused by the check constraint', async () => {
    const { error } = await serviceClient().from('referral_links').insert({
      referrer_id: outsider.id,
      referee_id: outsider.id,
      status: 'pending',
    });

    expect(error?.code, error?.message).toBe('23514');
  });

  /** An approved link without its clock would accrue for ever. */
  it('an approved link cannot exist without linked_at and expires_at', async () => {
    const r = await createUser('customer');
    const e = await createUser('customer');
    userIds.push(r.id, e.id);

    const { error } = await serviceClient().from('referral_links').insert({
      referrer_id: r.id,
      referee_id: e.id,
      status: 'approved',
    });

    expect(error?.code, error?.message).toBe('23514');
  });
});

describe('my_referral_overview — the shape is the privacy contract (docs/17 §6)', () => {
  beforeAll(async () => {
    await link(referrer.id, referee.id);

    // A pending one, and a rejected one that must not appear at all.
    const pending = await createUser('customer');
    const rejected = await createUser('customer');
    userIds.push(pending.id, rejected.id);
    await setName(pending.id, 'Fatime Hoxha');
    await setName(rejected.id, 'Refuzuar Person');
    await link(referrer.id, pending.id, { status: 'pending' });
    await link(referrer.id, rejected.id, { status: 'rejected' });
  });

  it('returns exactly the documented keys and nothing else', async () => {
    const { data, error } = await referrer.client.rpc('my_referral_overview');
    expect(error).toBeNull();

    const payload = data as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['code', 'referrals', 'stats']);

    expect(Object.keys(payload.stats as Record<string, unknown>).sort()).toEqual([
      'approved',
      'expired',
      'expiring_30d',
      'pending',
      'points_all_time',
      'points_this_month',
    ]);

    const rows = payload.referrals as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'days_left',
        'joined_month',
        'masked_name',
        'status',
      ]);
    }
  });

  /**
   * The assertion that survives a helpful future contributor.
   *
   * Adding `amount_cents` or `order_count` to the payload is a one-line change that looks like an
   * improvement and is the exact leak §0.2 forbids. Naming the forbidden *substrings* rather than an
   * allowlist means a field called `total_spend`, `orderCount` or `last_order_at` fails too.
   */
  it('contains no field that could carry a referee amount, count or date', async () => {
    const { data } = await referrer.client.rpc('my_referral_overview');
    const rows = (data as { referrals: Record<string, unknown>[] }).referrals;

    const forbidden = /amount|spend|cents|total|order|price|email|phone|address|revenue/i;
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        expect(key, `"${key}" could carry a referee's private data`).not.toMatch(forbidden);
      }
    }
  });

  /** A month, not a date: a signup date is correlatable with an order. */
  it('returns a join month, never a timestamp', async () => {
    const { data } = await referrer.client.rpc('my_referral_overview');
    const rows = (data as { referrals: { joined_month: string }[] }).referrals;

    for (const row of rows) expect(row.joined_month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('masks the referee to a first name and an initial', async () => {
    const { data } = await referrer.client.rpc('my_referral_overview');
    const rows = (data as { referrals: { masked_name: string }[] }).referrals;
    const names = rows.map((row) => row.masked_name);

    expect(names).toContain('Arta B.');
    expect(names.join(' ')).not.toContain('Berisha');
  });

  it('counts approved, pending and expiring correctly, and hides rejected', async () => {
    const { data } = await referrer.client.rpc('my_referral_overview');
    const payload = data as {
      stats: { approved: number; pending: number; expired: number };
      referrals: { masked_name: string; status: string }[];
    };

    expect(payload.stats.approved).toBe(1);
    expect(payload.stats.pending).toBe(1);
    expect(payload.referrals).toHaveLength(2);
    expect(payload.referrals.map((r) => r.status).sort()).toEqual(['approved', 'pending']);
    expect(payload.referrals.map((r) => r.masked_name)).not.toContain('Refuzuar P.');
  });

  it('shows the caller their own code', async () => {
    const { data } = await referrer.client.rpc('my_referral_overview');
    expect((data as { code: string }).code).toBe(await codeOf(referrer.id));
  });

  it('refuses an unauthenticated caller', async () => {
    const { anonClient } = await import('./helpers');
    const { error } = await anonClient().rpc('my_referral_overview');
    expect(error?.message ?? '').toMatch(/NOT_AUTHENTICATED|permission/i);
  });
});

describe('RLS — the absences that matter (docs/17 §6)', () => {
  /**
   * The referrer's direct read returns nothing **while the RPC returns rows**.
   *
   * Asserted in both directions on purpose: a test that only checks the empty result would still pass
   * if the whole feature were broken, which is how a security test goes quietly vacuous.
   */
  it('a referrer cannot select its own links directly, though the RPC can', async () => {
    const { data: direct } = await referrer.client
      .from('referral_links')
      .select('id, referee_id')
      .eq('referrer_id', referrer.id);

    expect(direct ?? []).toHaveLength(0);

    const { data: viaRpc } = await referrer.client.rpc('my_referral_overview');
    expect((viaRpc as { referrals: unknown[] }).referrals.length).toBeGreaterThan(0);
  });

  it('a referrer cannot read referral_earnings at all', async () => {
    const { data } = await referrer.client
      .from('referral_earnings')
      .select('id, points, base_cents');
    expect(data ?? []).toHaveLength(0);
  });

  it('a referee reads its own link row and no one else’s', async () => {
    const { data: own } = await referee.client.from('referral_links').select('id, referrer_id');
    expect(own ?? []).toHaveLength(1);
    expect((own as { referrer_id: string }[])[0]?.referrer_id).toBe(referrer.id);

    const { data: theirs } = await outsider.client.from('referral_links').select('id');
    expect(theirs ?? []).toHaveLength(0);
  });

  it('a referee learns who referred them, masked', async () => {
    const { data, error } = await referee.client.rpc('my_referral_source');
    expect(error).toBeNull();

    const payload = data as { referrer_name: string; status: string } | null;
    expect(payload?.referrer_name).toBe('Blerim K.');
    expect(payload?.status).toBe('approved');
  });

  it('a customer with no referrer gets null rather than an error', async () => {
    const { data, error } = await outsider.client.rpc('my_referral_source');
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('staff read every link', async () => {
    const { data } = await staff.client.from('referral_links').select('id');
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('a customer cannot write a link for themselves', async () => {
    const target = await createUser('customer');
    userIds.push(target.id);

    const { error } = await referrer.client.from('referral_links').insert({
      referrer_id: referrer.id,
      referee_id: target.id,
      status: 'approved',
      linked_at: new Date().toISOString(),
      expires_at: new Date().toISOString(),
    });

    // Self-approval would be the whole programme: a customer minting its own approved links.
    expect(error?.message ?? '').toMatch(/row-level security|permission/i);
  });
});

/**
 * docs/17 §0.1 — the unified point value.
 *
 * The referral accrual formula divides by `point_value_cents`, so these are not incidental loyalty
 * tests: if the wallet held two point values, an award of "100 points" would mean €1 when referral
 * wrote it and €5 when a purchase did, out of the same integer column.
 */
describe('one point value (docs/17 §0.1)', () => {
  it('settings carry the new keys and none of the old ones', async () => {
    const { data } = await serviceClient()
      .from('settings')
      .select('value')
      .eq('key', 'loyalty')
      .single();

    const value = (data as { value: Record<string, unknown> }).value;

    expect(Object.keys(value).sort()).toEqual([
      'earn_points_per_eur',
      'min_redeem_points',
      'point_value_cents',
    ]);
    expect(value.point_value_cents).toBe(1);
    expect(value.min_redeem_points).toBe(500);
  });

  /** Give a profile points the only legitimate way: a ledger row, which the sync trigger applies. */
  async function grant(userId: string, points: number): Promise<void> {
    const { error } = await serviceClient()
      .from('loyalty_transactions')
      .insert({ user_id: userId, points, reason: 'adjustment', note: 'test grant' });
    if (error) throw new Error(`grant failed: ${error.message}`);
  }

  it('mints a coupon worth exactly points × point_value_cents', async () => {
    const user = await createUser('customer');
    userIds.push(user.id);
    await grant(user.id, 700);

    const { data, error } = await user.client.rpc('redeem_loyalty_points', { p_points: 700 });
    expect(error).toBeNull();

    const result = data as { code: string; value_cents: number; points_spent: number };
    // 700 points at one cent each — €7, not the old fixed €5 tier.
    expect(result.value_cents).toBe(700);
    expect(result.points_spent).toBe(700);
    expect(result.code).toMatch(/^LOY-[A-Z0-9]{6}$/);

    const { data: coupon } = await serviceClient()
      .from('coupons')
      .select('value, type, max_uses')
      .eq('code', result.code)
      .single();

    const row = coupon as { value: number; type: string; max_uses: number };
    expect(row.value).toBe(700);
    expect(row.type).toBe('fixed');
    expect(row.max_uses).toBe(1);

    const { data: profile } = await serviceClient()
      .from('profiles')
      .select('loyalty_points')
      .eq('id', user.id)
      .single();
    expect((profile as { loyalty_points: number }).loyalty_points).toBe(0);
  });

  it('refuses below the minimum', async () => {
    const user = await createUser('customer');
    userIds.push(user.id);
    await grant(user.id, 900);

    const { error } = await user.client.rpc('redeem_loyalty_points', { p_points: 400 });
    expect(error?.message ?? '').toContain('BELOW_MINIMUM');
  });

  /** A minimum of 550 would be a floor no redemption could land on; the RPC refuses the shape. */
  it('refuses an amount that is not a multiple of 100', async () => {
    const user = await createUser('customer');
    userIds.push(user.id);
    await grant(user.id, 900);

    const { error } = await user.client.rpc('redeem_loyalty_points', { p_points: 550 });
    expect(error?.message ?? '').toContain('NOT_A_MULTIPLE_OF_100');
  });

  it('refuses more than the balance', async () => {
    const user = await createUser('customer');
    userIds.push(user.id);
    await grant(user.id, 500);

    const { error } = await user.client.rpc('redeem_loyalty_points', { p_points: 600 });
    expect(error?.message ?? '').toContain('INSUFFICIENT_POINTS');
  });

  /** Omitting the amount redeems the minimum, so a caller written against the old fixed tier works. */
  it('defaults to the minimum when no amount is given', async () => {
    const user = await createUser('customer');
    userIds.push(user.id);
    await grant(user.id, 500);

    const { data, error } = await user.client.rpc('redeem_loyalty_points');
    expect(error).toBeNull();
    expect((data as { points_spent: number }).points_spent).toBe(500);
    expect((data as { value_cents: number }).value_cents).toBe(500);
  });
});
