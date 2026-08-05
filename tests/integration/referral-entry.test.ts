import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { anonClient, createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/17 §1, §6 — code entry: the three ways a referral gets created, and everything that must not
 * be creatable.
 *
 * ── What is worth testing here ──
 *
 * The validation rules are the whole feature. Every one of them is a rule about *people* — the same
 * person twice, a friend's code typed as your own, an account that has already shopped — and each is
 * cheap to get subtly wrong in a way that only shows up as money paid to somebody who did not earn it.
 *
 * Two assertions in this file are about absences rather than behaviour, and those are the ones that
 * will fail years from now when somebody helpfully widens something:
 *
 *   • `link_referral` must not be callable by a signed-in customer. It takes a referee id as an
 *     argument, so a customer who could call it could link anybody to anybody.
 *   • Every rejection that says something about the *code* must come back as the same word. The moment
 *     one of them gets its own helpful message, the endpoint is a code oracle.
 */

const userIds: string[] = [];
let referrer: TestUser;
let referee: TestUser;
let outsider: TestUser;
/**
 * One signed-in customer for every case that is expected to be **rejected**.
 *
 * Shared rather than one per case because each rejection leaves no link behind — which the last
 * assertion in this file checks — so the account is still pristine for the next attempt. It also keeps
 * the number of `signInWithPassword` calls down; see `createBareUser`.
 */
let rejected: TestUser;

async function codeOf(id: string): Promise<string> {
  const { data } = await serviceClient()
    .from('profiles')
    .select('referral_code')
    .eq('id', id)
    .single();
  return (data as { referral_code: string }).referral_code;
}

async function linkRowFor(refereeId: string) {
  const { data } = await serviceClient()
    .from('referral_links')
    .select('id, referrer_id, status, source, code_used, risk_flags')
    .eq('referee_id', refereeId)
    .maybeSingle();
  return data as {
    id: string;
    referrer_id: string;
    status: string;
    source: string;
    code_used: string;
    risk_flags: string[];
  } | null;
}

/**
 * A confirmed user, created but **not signed in**.
 *
 * `helpers.createUser` signs in to hand back a JWT-carrying client, which is right for a test that
 * asserts through RLS and wasteful for one that does not. Supabase Auth rate-limits
 * `signInWithPassword` per IP on the hosted project, and this suite creates upwards of fifty accounts
 * in a run: the first version of this file added twenty-one sign-ins for clients it mostly threw away
 * and pushed the *whole* suite over the ceiling, failing twenty tests in files it never touched.
 *
 * So: sign in only where a customer-context client is actually needed. Most cases here assert on rows
 * the service client can read.
 *
 * `metadata` is the sign-up path's real mechanism — `raw_user_meta_data` is where the invite code
 * rides, because there is no session at sign-up when email confirmation is on.
 */
async function createBareUser(metadata?: Record<string, string>): Promise<string> {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email: `test-${randomUUID()}@biocode.test`,
    password: `Pw-${randomUUID()}`,
    email_confirm: true,
    ...(metadata ? { user_metadata: metadata } : {}),
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  return data.user.id;
}

/** The minimum row that makes `exists (select 1 from orders where user_id = …)` true. */
async function placeAnyOrder(userId: string): Promise<string> {
  const address = { line1: 'Rr. Test 1', city: 'Prishtinë', country_code: 'XK' };
  const { data, error } = await serviceClient()
    .from('orders')
    .insert({
      user_id: userId,
      email: `order-${randomUUID()}@biocode.test`,
      phone: '+38344123456',
      subtotal_cents: 1990,
      total_cents: 1990,
      shipping_address: address,
      billing_address: address,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`order insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

beforeAll(async () => {
  referrer = await createUser('customer');
  referee = await createUser('customer');
  outsider = await createUser('customer');
  rejected = await createUser('customer');
  userIds.push(referrer.id, referee.id, outsider.id, rejected.id);
});

afterAll(async () => {
  // `referral_links` cascades from `profiles`; orders null out their `user_id` and are swept by
  // the fixture purge, which keys on the `@biocode.test` address.
  for (const id of userIds) await deleteUser(id);
});

describe('normalize_referral_code (docs/17 §1)', () => {
  /*
   * The anti-drift assertion.
   *
   * `normalizeReferralCode` in TypeScript and `normalize_referral_code` in SQL implement one rule in
   * two languages, which is a drift risk taken deliberately: the form needs to reject a typo while the
   * customer is still looking at it, and the database needs to be the boundary. This test and the
   * matching table in `tests/unit/referral-code.test.ts` are what keep them honest.
   */
  it('accepts every form a customer types', async () => {
    const code = await codeOf(referrer.id);
    const body = code.slice(4);

    for (const input of [code, code.toLowerCase(), `bio${body}`, body, ` BIO ${body} `]) {
      const { data, error } = await serviceClient().rpc('normalize_referral_code', {
        p_code: input,
      });
      expect(error, input).toBeNull();
      expect(data, input).toBe(code);
    }
  });

  it('rejects what cannot be a code', async () => {
    for (const input of ['BIO-K7F2', 'BIO-K7F2MM', 'BIO-K7F2O', 'BIO-K7F21', '', 'hello']) {
      const { data } = await serviceClient().rpc('normalize_referral_code', { p_code: input });
      expect(data, input).toBeNull();
    }
  });
});

describe('the sign-up path (docs/17 §1)', () => {
  it('links the code carried in sign-up metadata', async () => {
    const code = await codeOf(referrer.id);
    const created = await createBareUser({ full_name: 'Elira Hoxha', referral_code: code });

    const row = await linkRowFor(created);
    expect(row?.referrer_id).toBe(referrer.id);
    expect(row?.status).toBe('pending');
    expect(row?.source).toBe('signup');
    expect(row?.code_used).toBe(code);
  });

  it('records `link` when the code came from a share link', async () => {
    const code = await codeOf(referrer.id);
    const created = await createBareUser({
      full_name: 'Rron Bytyqi',
      referral_code: code,
      referral_source: 'link',
    });

    expect((await linkRowFor(created))?.source).toBe('link');
  });

  it('normalises a code typed without the prefix', async () => {
    const code = await codeOf(referrer.id);
    const created = await createBareUser({
      full_name: 'Diona Krasniqi',
      referral_code: code.slice(4).toLowerCase(),
    });

    expect((await linkRowFor(created))?.code_used).toBe(code);
  });

  /*
   * The one that matters most in this describe block.
   *
   * `link_referral` runs inside `handle_new_user`, so a rejection that escaped as an exception would
   * abort the insert into `auth.users` and the customer would simply be unable to register. A dropped
   * referral can be repaired by hand from the admin panel; a sign-up form that refuses everybody
   * cannot be repaired from anywhere.
   */
  it('still creates the account when the code is nonsense', async () => {
    const created = await createBareUser({
      full_name: 'Leart Shala',
      referral_code: 'not-a-code-at-all',
    });

    expect(created).toBeTruthy();
    expect(await linkRowFor(created)).toBeNull();
  });

  it('sanitises a source it does not recognise rather than failing the insert', async () => {
    const code = await codeOf(referrer.id);
    const created = await createBareUser({
      full_name: 'Endrit Musa',
      referral_code: code,
      referral_source: 'whatever-the-caller-felt-like',
    });

    // The column's check constraint allows four values; an unknown one becomes `signup`, and the link
    // exists — rather than the insert failing and the referral vanishing into the exception guard.
    expect((await linkRowFor(created))?.source).toBe('signup');
  });

  it('issues the new account its own code as well', async () => {
    const created = await createBareUser({
      full_name: 'Vesa Dema',
      referral_code: await codeOf(referrer.id),
    });

    expect(await codeOf(created)).toMatch(/^BIO-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });
});

describe('claim_referral_code — the grace window (docs/17 §1)', () => {
  it('links the caller and records the account as the source', async () => {
    const code = await codeOf(referrer.id);
    const { data, error } = await referee.client.rpc('claim_referral_code', { p_code: code });

    expect(error).toBeNull();
    expect(data).toEqual({ status: 'ok' });

    const row = await linkRowFor(referee.id);
    expect(row?.referrer_id).toBe(referrer.id);
    expect(row?.status).toBe('pending');
    expect(row?.source).toBe('account');
  });

  it('refuses a second referrer, for ever', async () => {
    // `referee` was linked by the test above. One referrer per customer is the rule the unique
    // constraint enforces; this is the message the customer gets.
    const { data } = await referee.client.rpc('claim_referral_code', {
      p_code: await codeOf(outsider.id),
    });
    expect(data).toEqual({ status: 'already_linked' });
    expect((await linkRowFor(referee.id))?.referrer_id).toBe(referrer.id);
  });

  it('names the mistake when somebody enters their own code', async () => {
    /*
     * `self` survives collapsing while everything else does not, and the distinction is the point: it
     * is a fact about the caller's *own* account, which they can already see, so telling them reveals
     * nothing and saves a support email. Every fact about somebody *else's* code collapses to
     * `invalid` — see the next describe block.
     */
    const { data } = await rejected.client.rpc('claim_referral_code', {
      p_code: await codeOf(rejected.id),
    });
    expect(data).toEqual({ status: 'self' });
    expect(await linkRowFor(rejected.id)).toBeNull();
  });

  it('closes once the customer has ordered', async () => {
    const shopper = await createUser('customer');
    userIds.push(shopper.id);
    await placeAnyOrder(shopper.id);

    const { data } = await shopper.client.rpc('claim_referral_code', {
      p_code: await codeOf(referrer.id),
    });
    expect(data).toEqual({ status: 'grace_closed' });
    expect(await linkRowFor(shopper.id)).toBeNull();
  });

  /*
   * Stopped by the grant, before the function's own `auth.uid()` guard ever runs — which is the
   * stronger of the two and the one worth asserting. `execute` is granted to `authenticated` only, so
   * an anonymous caller cannot reach the body to be told anything at all, including whether a code
   * exists. The `NOT_AUTHENTICATED` raise inside remains as defence for a future grant mistake.
   */
  it('is not open to anonymous callers', async () => {
    const { error } = await anonClient().rpc('claim_referral_code', { p_code: 'BIO-K7F2M' });
    expect(error?.message).toContain('permission denied');
  });
});

describe('one generic rejection (docs/17 §6)', () => {
  /*
   * The endpoint must not distinguish "no such code" from "a code that exists but cannot be used by
   * you". Anything else is an oracle: a script could walk the 32^5 space learning which codes are
   * real, and a fraudster would learn exactly which of their signals tripped and change it.
   *
   * Asserted as a set rather than case by case, so a future rejection reason that forgets to collapse
   * shows up as a difference in this one place.
   */
  it('answers the same word for every reason that is about the code', async () => {
    const answers: Record<string, unknown> = {};

    // No such code.
    {
      const { data } = await rejected.client.rpc('claim_referral_code', { p_code: 'BIO-ZZZZZ' });
      answers['no such code'] = data;
    }

    // Same phone number as the referrer: the same person twice.
    {
      const phone = '+38344999001';
      await serviceClient().from('profiles').update({ phone }).eq('id', referrer.id);
      await serviceClient().from('profiles').update({ phone }).eq('id', rejected.id);

      const { data } = await rejected.client.rpc('claim_referral_code', {
        p_code: await codeOf(referrer.id),
      });
      answers['same phone'] = data;

      // Reset, or the flag tests further down would inherit a phone match they did not ask for.
      await serviceClient().from('profiles').update({ phone: null }).eq('id', referrer.id);
      await serviceClient().from('profiles').update({ phone: null }).eq('id', rejected.id);
    }

    // A cycle: the referrer's own referrer trying to be referred by them.
    {
      // `referrer` is already the referrer of `referee`. So `referrer` claiming `referee`'s code
      // would close a loop.
      const { data } = await referrer.client.rpc('claim_referral_code', {
        p_code: await codeOf(referee.id),
      });
      answers['cycle'] = data;
    }

    expect(answers).toEqual({
      'no such code': { status: 'invalid' },
      'same phone': { status: 'invalid' },
      cycle: { status: 'invalid' },
    });
  });

  /*
   * Four rejections have now been thrown at one account — its own code, a code that does not exist, a
   * code whose owner shares its phone number, and (below) a programme that is switched off. None may
   * have left a row behind, because `referral_links` is unique on `referee_id`: a rejected attempt that
   * wrote anything would permanently consume the customer's one and only referrer slot.
   */
  it('leaves no link behind when it rejects', async () => {
    expect(await linkRowFor(rejected.id)).toBeNull();
    expect(await linkRowFor(referrer.id)).toBeNull();
  });
});

describe('link_referral is not reachable by a customer (docs/17 §6)', () => {
  /*
   * It takes a referee id as a parameter and performs no `auth.uid()` check of its own — that is
   * `claim_referral_code`'s job — so a customer able to call it could link any two accounts, including
   * making themselves the referrer of a stranger who is about to place a large order.
   *
   * Both roles asserted, because a `revoke` that misses one is silent.
   */
  it('rejects a signed-in caller', async () => {
    const { error } = await referee.client.rpc('link_referral', {
      p_referee_id: outsider.id,
      p_code: await codeOf(referee.id),
      p_source: 'account',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an anonymous caller', async () => {
    const { error } = await anonClient().rpc('link_referral', {
      p_referee_id: outsider.id,
      p_code: 'BIO-K7F2M',
      p_source: 'account',
    });
    expect(error).not.toBeNull();
  });

  it('still leaves the outsider unlinked', async () => {
    expect(await linkRowFor(outsider.id)).toBeNull();
  });
});

describe('risk flags (docs/17 §5)', () => {
  /** A shared delivery address is a family or a farm, and only a human can tell which. */
  it('flags a shared address without refusing the link', async () => {
    const flagged = await createUser('customer');
    userIds.push(flagged.id);

    const address = {
      recipient_name: 'Test Recipient',
      phone: '+38344123457',
      line1: 'Rr. Dëshmorët e Kombit 12',
      city: 'Prishtinë',
    };
    const sharer = await createBareUser();

    await serviceClient()
      .from('addresses')
      .insert([
        { ...address, user_id: flagged.id },
        { ...address, user_id: sharer },
      ]);

    const { data } = await flagged.client.rpc('claim_referral_code', {
      p_code: await codeOf(sharer),
    });

    expect(data).toEqual({ status: 'ok' });
    expect((await linkRowFor(flagged.id))?.risk_flags).toContain('same_address');
  });

  it('flags a burst of sign-ups on one code', async () => {
    const busy = await createBareUser();
    const code = await codeOf(busy);

    // Four in a row: the first three are unflagged, the fourth trips the threshold.
    const flags: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      const joiner = await createBareUser({
        full_name: `Joiner ${i}`,
        referral_code: code,
      });
      flags.push((await linkRowFor(joiner))?.risk_flags ?? []);
    }

    expect(flags[0]).not.toContain('rapid_signup');
    expect(flags[3]).toContain('rapid_signup');
  });
});

describe('the programme switch (docs/17 §2)', () => {
  /*
   * Restored in a `finally`, because the suite shares one database and runs its files in sequence: a
   * throw between the two writes would leave the programme off for every test that comes after, and
   * the failure would appear somewhere else entirely.
   */
  it('refuses to link anything while disabled', async () => {
    const service = serviceClient();
    const { data: before } = await service
      .from('settings')
      .select('value')
      .eq('key', 'referral')
      .single();
    const original = (before as { value: Record<string, unknown> }).value;

    try {
      await service
        .from('settings')
        .update({ value: { ...original, enabled: false } })
        .eq('key', 'referral');

      const { data } = await rejected.client.rpc('claim_referral_code', {
        p_code: await codeOf(referrer.id),
      });

      // Collapsed to the generic answer: whether the programme is running is not something a
      // rejection needs to reveal, and the customer's next step is the same either way.
      expect(data).toEqual({ status: 'invalid' });
      expect(await linkRowFor(rejected.id)).toBeNull();
    } finally {
      await service.from('settings').update({ value: original }).eq('key', 'referral');
    }
  });
});
