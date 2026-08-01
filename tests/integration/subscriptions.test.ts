import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createProduct,
  createUser,
  defaultShippingMethodId,
  serviceClient,
  type ProductFixture,
  type TestUser,
} from './helpers';

/**
 * docs/07 §8.2 — the renewal engine's guarantees, against the real database.
 *
 * These are integration tests rather than E2E because the interesting behaviour is not on a
 * screen: the claim is a single SQL statement, and what has to be proved is what happens when
 * two callers race it. A browser cannot express that; a second `await` can.
 *
 * The engine's TypeScript half is not imported — it is `server-only` and pulls in Next's request
 * scope. What is exercised here is the layer everything else depends on: `claim_due_subscription`
 * and its siblings. If those hold, a duplicate order requires the cron to ignore a null.
 */

let shippingMethodId: string;

beforeAll(async () => {
  shippingMethodId = await defaultShippingMethodId();
});

/** An active subscription for `user`, due at `dueAt`, containing one line of `product`. */
async function createSubscription(
  user: TestUser,
  product: ProductFixture,
  dueAt: Date,
  overrides: { frequencyDays?: number; status?: string; pausedUntil?: string | null } = {},
): Promise<string> {
  const service = serviceClient();

  const { data, error } = await service
    .from('subscriptions')
    .insert({
      user_id: user.id,
      status: overrides.status ?? 'active',
      frequency_days: overrides.frequencyDays ?? 30,
      next_run_at: dueAt.toISOString(),
      paused_until: overrides.pausedUntil ?? null,
      discount_pct: 10,
      shipping_address: {
        recipient_name: 'Test Abonuesi',
        phone: '+38344000000',
        line1: 'Rruga A, nr. 1',
        city: 'Prishtinë',
        country_code: 'XK',
      },
      shipping_method_id: shippingMethodId,
      payment_provider: 'cod',
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`subscription insert failed: ${error?.message}`);
  const id = (data as { id: string }).id;

  const { error: itemError } = await service
    .from('subscription_items')
    .insert({ subscription_id: id, variant_id: product.variantId, quantity: 2 });
  if (itemError) throw new Error(`subscription item insert failed: ${itemError.message}`);

  return id;
}

/**
 * The date, `frequencyDays` later, as `YYYY-MM-DD`.
 *
 * `subscriptions.next_run_at` is a **date**, not a timestamp — a delivery cadence is measured
 * in days and storing a time of day would imply a precision the courier does not have. So the
 * assertions below compare dates. Comparing epoch milliseconds against a date column looks
 * stricter and is simply wrong: it fails by however far through the day the suite happens to
 * run, which is a clock reading, not a defect.
 */
function datePlusDays(from: Date, days: number): string {
  const result = new Date(from.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

describe('claim_due_subscription — idempotency (docs/12 M9 acceptance)', () => {
  it('claims a due subscription exactly once, however many times it is called', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const id = await createSubscription(user, product, new Date(Date.now() - 60_000));

    const first = await service.rpc('claim_due_subscription', { p_subscription_id: id });
    const second = await service.rpc('claim_due_subscription', { p_subscription_id: id });
    const third = await service.rpc('claim_due_subscription', { p_subscription_id: id });

    expect(first.data, 'the first call claims it').not.toBeNull();
    /*
     * The whole acceptance criterion, in two lines. A second cron invocation — a retry, an
     * overlapping run, somebody curling the endpoint twice — gets nothing, because the claim and
     * the schedule advance are one statement.
     */
    expect(second.data, 'a second call gets nothing').toBeNull();
    expect(third.data, 'and so does a third').toBeNull();
  });

  it('advances the schedule by exactly one cycle', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const due = new Date(Date.now() - 60_000);
    const id = await createSubscription(user, product, due, { frequencyDays: 45 });

    await service.rpc('claim_due_subscription', { p_subscription_id: id });

    const { data } = await service
      .from('subscriptions')
      .select('next_run_at')
      .eq('id', id)
      .single();

    // Exactly 45 days on from the stored date, because Postgres did the arithmetic against
    // the stored value rather than against "now".
    expect((data as { next_run_at: string }).next_run_at).toBe(datePlusDays(due, 45));
  });

  it('returns the buyable lines and drops the withdrawn ones', async () => {
    const service = serviceClient();
    const user = await createUser();
    const good = await createProduct();
    const withdrawn = await createProduct();

    const id = await createSubscription(user, good, new Date(Date.now() - 60_000));
    await service
      .from('subscription_items')
      .insert({ subscription_id: id, variant_id: withdrawn.variantId, quantity: 1 });

    // Unpublish one of them after the fact — the case docs/07 §8.2 calls "skip that line".
    await service.from('products').update({ status: 'archived' }).eq('id', withdrawn.productId);

    const { data } = await service.rpc('claim_due_subscription', { p_subscription_id: id });
    const claimed = data as { items: { variant_id: string }[] } | null;

    expect(claimed?.items).toHaveLength(1);
    expect(claimed?.items[0]?.variant_id).toBe(good.variantId);
  });

  it('does not claim a subscription that is not due yet', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const id = await createSubscription(user, product, new Date(Date.now() + 86_400_000));

    const { data } = await service.rpc('claim_due_subscription', { p_subscription_id: id });
    expect(data).toBeNull();
  });

  it('does not claim a paused subscription, but does claim one whose pause has expired', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const due = new Date(Date.now() - 60_000);

    const indefinite = await createSubscription(user, product, due, { status: 'paused' });
    const expired = await createSubscription(user, product, due, {
      status: 'paused',
      pausedUntil: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const stillPaused = await service.rpc('claim_due_subscription', {
      p_subscription_id: indefinite,
    });
    expect(stillPaused.data, 'an indefinite pause is respected').toBeNull();

    const resumed = await service.rpc('claim_due_subscription', { p_subscription_id: expired });
    // docs/07 §8.3 — "cron auto-resumes". The claim is where that happens.
    expect(resumed.data, 'a pause whose date has passed is not a pause').not.toBeNull();

    const { data: after } = await service
      .from('subscriptions')
      .select('status, paused_until')
      .eq('id', expired)
      .single();

    const row = after as { status: string; paused_until: string | null };
    expect(row.status).toBe('active');
    expect(row.paused_until).toBeNull();
  });
});

describe('customer controls (docs/07 §8.3)', () => {
  it('skipping moves the next delivery by one cycle and nothing else', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const due = new Date(Date.now() + 3 * 86_400_000);
    const id = await createSubscription(user, product, due, { frequencyDays: 30 });

    // Through the customer's own client, so RLS and the ownership re-check both apply.
    const { data: ok } = await user.client.rpc('skip_subscription_cycle', {
      p_subscription_id: id,
    });
    expect(ok).toBe(true);

    const { data } = await service
      .from('subscriptions')
      .select('next_run_at, status, frequency_days')
      .eq('id', id)
      .single();

    const row = data as { next_run_at: string; status: string; frequency_days: number };
    expect(row.next_run_at).toBe(datePlusDays(due, 30));
    expect(row.status, 'skipping is not pausing').toBe('active');
    expect(row.frequency_days, 'and it does not change the cadence').toBe(30);
  });

  it('one customer cannot skip another customer’s subscription', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const product = await createProduct();
    const id = await createSubscription(owner, product, new Date(Date.now() + 86_400_000));

    /*
     * `skip_subscription_cycle` is `security definer`, so RLS does not protect it — the
     * ownership check is written into the function by hand. That makes this the test that
     * matters: a definer function with a missing predicate is a hole with a friendly API.
     */
    const { data } = await stranger.client.rpc('skip_subscription_cycle', {
      p_subscription_id: id,
    });
    expect(data).toBe(false);
  });

  it('resuming a long pause rolls the date forward instead of shipping immediately', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();

    // Paused two months ago on a 30-day cadence: `next_run_at` is deep in the past.
    const longAgo = new Date(Date.now() - 65 * 86_400_000);
    const id = await createSubscription(user, product, longAgo, { status: 'paused' });

    const { data: ok } = await user.client.rpc('resume_subscription', { p_subscription_id: id });
    expect(ok).toBe(true);

    const { data } = await service
      .from('subscriptions')
      .select('status, next_run_at')
      .eq('id', id)
      .single();

    const row = data as { status: string; next_run_at: string };
    expect(row.status).toBe('active');
    /*
     * The point of the test: resuming must not mean "ship now". A customer who unpauses in
     * January should not receive a parcel that afternoon for a cycle they were away for.
     */
    expect(Date.parse(row.next_run_at)).toBeGreaterThan(Date.now());
  });
});

describe('one-click tokens (docs/07 §8.2)', () => {
  async function mintToken(subscriptionId: string, action: 'skip' | 'pause', expiresAt: Date) {
    const service = serviceClient();
    const { data, error } = await service
      .from('subscription_action_tokens')
      .insert({ subscription_id: subscriptionId, action, expires_at: expiresAt.toISOString() })
      .select('token')
      .single();
    if (error || !data) throw new Error(`token insert failed: ${error?.message}`);
    return (data as { token: string }).token;
  }

  it('skips without a session, and cannot be replayed', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const due = new Date(Date.now() + 3 * 86_400_000);
    const id = await createSubscription(user, product, due);

    const token = await mintToken(id, 'skip', new Date(Date.now() + 86_400_000));

    // The anon client: no session at all, which is the entire point of the notice email links.
    const anon = (await import('./helpers')).anonClient();

    const first = await anon.rpc('subscription_apply_token', { p_token: token });
    expect((first.data as { ok: boolean }).ok).toBe(true);

    const second = await anon.rpc('subscription_apply_token', { p_token: token });
    const replay = second.data as { ok: boolean; reason: string };
    expect(replay.ok, 'a spent token is spent').toBe(false);
    expect(replay.reason).toBe('used');

    const { data } = await service
      .from('subscriptions')
      .select('next_run_at')
      .eq('id', id)
      .single();

    // Moved exactly one cycle, not two — the replay changed nothing.
    expect((data as { next_run_at: string }).next_run_at).toBe(datePlusDays(due, 30));
  });

  it('refuses an expired token', async () => {
    const user = await createUser();
    const product = await createProduct();
    const id = await createSubscription(user, product, new Date(Date.now() + 86_400_000));

    const token = await mintToken(id, 'pause', new Date(Date.now() - 60_000));
    const anon = (await import('./helpers')).anonClient();

    const { data } = await anon.rpc('subscription_apply_token', { p_token: token });
    expect((data as { ok: boolean; reason: string }).reason).toBe('expired');
  });

  it('refuses a token that was never minted', async () => {
    const anon = (await import('./helpers')).anonClient();
    const { data } = await anon.rpc('subscription_apply_token', {
      p_token: `not-a-real-token-${randomUUID()}`,
    });
    expect((data as { ok: boolean; reason: string }).reason).toBe('not_found');
  });
});

describe('failure handling (docs/07 §8.2)', () => {
  it('pauses after three consecutive failures and clears on success', async () => {
    const service = serviceClient();
    const user = await createUser();
    const product = await createProduct();
    const id = await createSubscription(user, product, new Date(Date.now() + 86_400_000));

    for (const expected of [1, 2]) {
      const { data } = await service.rpc('record_subscription_failure', {
        p_subscription_id: id,
      });
      expect(data).toBe(expected);
    }

    const { data: still } = await service
      .from('subscriptions')
      .select('status')
      .eq('id', id)
      .single();
    expect((still as { status: string }).status, 'two failures is not enough').toBe('active');

    const { data: third } = await service.rpc('record_subscription_failure', {
      p_subscription_id: id,
    });
    expect(third).toBe(3);

    const { data: paused } = await service
      .from('subscriptions')
      .select('status')
      .eq('id', id)
      .single();
    // Paused, not cancelled: three months of an out-of-stock item is not a decision for a cron.
    expect((paused as { status: string }).status).toBe('paused');

    await service.rpc('record_subscription_success', { p_subscription_id: id });
    const { data: cleared } = await service
      .from('subscriptions')
      .select('consecutive_failures')
      .eq('id', id)
      .single();
    expect((cleared as { consecutive_failures: number }).consecutive_failures).toBe(0);
  });
});
