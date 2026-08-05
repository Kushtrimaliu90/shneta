import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { anonClient, createUser, deleteUser, serviceClient, type TestUser } from './helpers';

/**
 * docs/17 §5 — the admin mutations.
 *
 * Two things this file is for. The obvious one is that plpgsql defers validating a function body until
 * first execution (docs/13 §X1, §Y1), so an admin RPC nobody has run is an admin RPC nobody knows
 * compiles — and these five are exactly the ones an operator reaches for on a bad day.
 *
 * The less obvious one is the role split. docs/17 §5 gives support the queue and revocation, and keeps
 * everything that mints money for admin. That is written twice — in `roles.ts` for the UI and in each
 * function's own `has_any_role` check — and only the second is a boundary. So each mutation is called by
 * a customer, by support and by an admin, and the assertion is on who is refused.
 */

const service = serviceClient();
const userIds: string[] = [];

let admin: TestUser;
let support: TestUser;
let customer: TestUser;

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

async function emailOf(id: string): Promise<string> {
  const { data } = await service.from('profiles').select('email').eq('id', id).single();
  return (data as { email: string }).email;
}

/** A pending link, the state the queue works on. */
async function pendingLink(referrerId: string, refereeId: string): Promise<string> {
  const { data, error } = await service
    .from('referral_links')
    .insert({
      referrer_id: referrerId,
      referee_id: refereeId,
      status: 'pending',
      source: 'signup',
      code_used: await codeOf(referrerId),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`link insert failed: ${error?.message}`);
  return (data as { id: string }).id;
}

async function linkRow(id: string) {
  const { data } = await service
    .from('referral_links')
    .select('status, linked_at, expires_at, approved_by, revoked_at, revoke_reason, extended_count')
    .eq('id', id)
    .single();
  return data as {
    status: string;
    linked_at: string | null;
    expires_at: string | null;
    approved_by: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
    extended_count: number;
  };
}

async function auditRows(action: string, entityId: string) {
  const { data } = await service
    .from('audit_logs')
    .select('action, actor_role, entity_type, after, ip')
    .eq('action', action)
    .eq('entity_id', entityId);
  return (data ?? []) as {
    action: string;
    actor_role: string;
    entity_type: string;
    after: Record<string, unknown> | null;
    ip: string | null;
  }[];
}

beforeAll(async () => {
  admin = await createUser('admin');
  support = await createUser('support');
  customer = await createUser('customer');
  userIds.push(admin.id, support.id, customer.id);
});

afterAll(async () => {
  for (const id of userIds) await deleteUser(id);
});

describe('approve and reject (docs/17 §5)', () => {
  it('approval starts the twelve-month clock and records who did it', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());

    const { data, error } = await support.client.rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: true,
      p_note: 'looks genuine',
    });
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'approved' });

    const row = await linkRow(link);
    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe(support.id);

    /*
     * The clock starts now, not at signup — so the time a link spent in this queue is BioCode's delay
     * to own rather than the referrer's to lose (docs/17 §1).
     */
    expect(row.linked_at).not.toBeNull();
    expect(row.expires_at).not.toBeNull();
    const months =
      (new Date(row.expires_at ?? '').getTime() - new Date(row.linked_at ?? '').getTime()) /
      (1000 * 60 * 60 * 24);
    expect(months).toBeGreaterThan(360);
    expect(months).toBeLessThan(371);
  });

  it('rejection leaves no clock at all', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    const { data } = await support.client.rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: false,
      p_note: 'same household',
    });
    expect(data).toEqual({ status: 'rejected' });

    const row = await linkRow(link);
    expect(row.status).toBe('rejected');
    expect(row.linked_at).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.revoke_reason).toBe('same household');
  });

  /*
   * A decided link is not re-decidable. Re-approving a revoked one would restart a clock that has
   * already run, and rejecting an approved one would leave earnings hanging off a rejected link —
   * revocation is the operation for that, and it keeps the money.
   */
  it('refuses to decide the same link twice', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    await support.client.rpc('admin_decide_referral', { p_link_id: link, p_approve: true });

    const { error } = await support.client.rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: false,
    });
    expect(error?.message).toContain('LINK_ALREADY_DECIDED');
  });

  it('is closed to a customer', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    const { error } = await customer.client.rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: true,
    });
    expect(error?.message).toContain('FORBIDDEN');
    expect((await linkRow(link)).status).toBe('pending');
  });

  it('is closed to an anonymous caller', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    const { error } = await anonClient().rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: true,
    });
    expect(error).not.toBeNull();
    expect((await linkRow(link)).status).toBe('pending');
  });
});

describe('revoke (docs/17 §1)', () => {
  it('stops the link and keeps the reason', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    const { data, error } = await support.client.rpc('admin_revoke_referral', {
      p_link_id: link,
      p_reason: 'duplicate account',
    });

    expect(error).toBeNull();
    expect(data).toEqual({ status: 'revoked', changed: true });

    const row = await linkRow(link);
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoke_reason).toBe('duplicate account');
  });

  /** A revocation nobody can explain is unanswerable when the referrer asks three months later. */
  it('requires a reason', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    const { error } = await support.client.rpc('admin_revoke_referral', {
      p_link_id: link,
      p_reason: '   ',
    });
    expect(error?.message).toContain('REASON_REQUIRED');
  });

  it('is idempotent rather than an error', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    await support.client.rpc('admin_revoke_referral', { p_link_id: link, p_reason: 'first' });

    const { data } = await support.client.rpc('admin_revoke_referral', {
      p_link_id: link,
      p_reason: 'again',
    });
    // Already stopped, so nothing changed — and the original reason is not overwritten.
    expect(data).toEqual({ status: 'revoked', changed: false });
    expect((await linkRow(link)).revoke_reason).toBe('first');
  });

  /** The blunt instrument, and the one thing support may not reach for. */
  it('revoke-all is admin only', async () => {
    const referrer = await bareUser();
    await pendingLink(referrer, await bareUser());
    await pendingLink(referrer, await bareUser());

    const denied = await support.client.rpc('admin_revoke_referrals_for', {
      p_referrer_id: referrer,
      p_reason: 'farm',
    });
    expect(denied.error?.message).toContain('FORBIDDEN');

    const allowed = await admin.client.rpc('admin_revoke_referrals_for', {
      p_referrer_id: referrer,
      p_reason: 'farm',
    });
    expect(allowed.error).toBeNull();
    expect(allowed.data).toBe(2);
  });
});

describe('extend (docs/17 §1)', () => {
  async function approvedLink(): Promise<string> {
    const link = await pendingLink(await bareUser(), await bareUser());
    await admin.client.rpc('admin_decide_referral', { p_link_id: link, p_approve: true });
    return link;
  }

  it('moves the end date once, and refuses a second time', async () => {
    const link = await approvedLink();
    const before = await linkRow(link);

    const { error } = await admin.client.rpc('admin_extend_referral', {
      p_link_id: link,
      p_months: 3,
      p_note: 'goodwill after a delivery problem',
    });
    expect(error).toBeNull();

    const after = await linkRow(link);
    expect(after.extended_count).toBe(1);
    expect(new Date(after.expires_at ?? '').getTime()).toBeGreaterThan(
      new Date(before.expires_at ?? '').getTime(),
    );

    // "Not extendable, except once" — the second request is a conversation, not a click.
    const second = await admin.client.rpc('admin_extend_referral', {
      p_link_id: link,
      p_months: 3,
      p_note: 'again',
    });
    expect(second.error?.message).toContain('ALREADY_EXTENDED');
  });

  it('requires a note and a sane number of months', async () => {
    const link = await approvedLink();

    const noNote = await admin.client.rpc('admin_extend_referral', {
      p_link_id: link,
      p_months: 3,
      p_note: ' ',
    });
    expect(noNote.error?.message).toContain('NOTE_REQUIRED');

    const silly = await admin.client.rpc('admin_extend_referral', {
      p_link_id: link,
      p_months: 99,
      p_note: 'why not',
    });
    expect(silly.error?.message).toContain('MONTHS_OUT_OF_RANGE');
  });

  it('is admin only, and refuses a link that is not running', async () => {
    const link = await approvedLink();
    const denied = await support.client.rpc('admin_extend_referral', {
      p_link_id: link,
      p_months: 1,
      p_note: 'support tried',
    });
    expect(denied.error?.message).toContain('FORBIDDEN');

    const pending = await pendingLink(await bareUser(), await bareUser());
    const notActive = await admin.client.rpc('admin_extend_referral', {
      p_link_id: pending,
      p_months: 1,
      p_note: 'not yet approved',
    });
    expect(notActive.error?.message).toContain('LINK_NOT_ACTIVE');
  });
});

describe('the manual link (docs/17 §5)', () => {
  it('creates an approved link from a code and an email', async () => {
    const referrer = await bareUser();
    const referee = await bareUser();

    const { data, error } = await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(referrer),
      p_referee_email: await emailOf(referee),
      p_note: 'told me in the shop',
      p_backdate_days: 0,
    });

    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe('approved');

    const { data: row } = await service
      .from('referral_links')
      .select('status, source, referrer_id')
      .eq('referee_id', referee)
      .single();
    expect(row).toMatchObject({ status: 'approved', source: 'admin', referrer_id: referrer });
  });

  /*
   * The assertion that makes the manual path safe: it goes through `link_referral`, so it obeys every
   * rule the automatic path does. An admin override that skipped them would be the hole every other
   * check is guarding.
   */
  it('still refuses a self-referral', async () => {
    const person = await bareUser();
    const { error } = await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(person),
      p_referee_email: await emailOf(person),
      p_note: 'should not work',
    });
    expect(error?.message).toContain('LINK_REFUSED');
  });

  it('still refuses a second referrer for the same customer', async () => {
    const referee = await bareUser();
    await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(await bareUser()),
      p_referee_email: await emailOf(referee),
      p_note: 'first',
    });

    const { error } = await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(await bareUser()),
      p_referee_email: await emailOf(referee),
      p_note: 'second',
    });
    expect(error?.message).toContain('LINK_REFUSED');
  });

  it('backdating shortens the remaining time rather than extending it', async () => {
    const referee = await bareUser();
    await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(await bareUser()),
      p_referee_email: await emailOf(referee),
      p_note: 'recommended two months ago',
      p_backdate_days: 60,
    });

    const { data } = await service
      .from('referral_links')
      .select('linked_at, expires_at')
      .eq('referee_id', referee)
      .single();
    const row = data as { linked_at: string; expires_at: string };

    // Started 60 days ago, so it ends 60 days earlier than a link approved today would.
    const daysLeft = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(300);
    expect(daysLeft).toBeLessThan(310);
  });

  it('says so when there is no such customer', async () => {
    const { error } = await admin.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(await bareUser()),
      p_referee_email: 'nobody-at-all@biocode.test',
      p_note: 'typo',
    });
    expect(error?.message).toContain('REFEREE_NOT_FOUND');
  });

  it('is admin only', async () => {
    const { error } = await support.client.rpc('admin_create_referral_link', {
      p_code: await codeOf(await bareUser()),
      p_referee_email: await emailOf(await bareUser()),
      p_note: 'support tried',
    });
    expect(error?.message).toContain('FORBIDDEN');
  });
});

describe('every mutation is audited (docs/17 §5)', () => {
  /*
   * The audit row is written inside the function rather than by the server action, so it exists however
   * the mutation was reached — the action, the cron, or a psql session. This asserts the row and the
   * two fields that make it usable: who did it, and the note explaining why.
   */
  it('records the actor, the role and the note', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    await support.client.rpc('admin_decide_referral', {
      p_link_id: link,
      p_approve: true,
      p_note: 'checked the address',
      p_ip: '203.0.113.7',
    });

    const rows = await auditRows('referral.approve', link);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_role).toBe('support');
    expect(rows[0]?.entity_type).toBe('referral_link');
    expect(rows[0]?.after).toMatchObject({ note: 'checked the address' });
    // The IP comes from the request and is passed down; without it these would be the one set of
    // audit rows in the panel with a null `ip`.
    expect(rows[0]?.ip).toBe('203.0.113.7');
  });

  it('records a revocation with its reason', async () => {
    const link = await pendingLink(await bareUser(), await bareUser());
    await support.client.rpc('admin_revoke_referral', {
      p_link_id: link,
      p_reason: 'shared payment card',
    });

    const rows = await auditRows('referral.revoke', link);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({ reason: 'shared payment card' });
  });
});

describe('the fraud view (docs/17 §5)', () => {
  it('lists a referrer with several links and stays shut to customers', async () => {
    const referrer = await bareUser();
    await pendingLink(referrer, await bareUser());
    await pendingLink(referrer, await bareUser());
    await pendingLink(referrer, await bareUser());

    const { data, error } = await support.client
      .from('referral_fraud_signals')
      .select('*')
      .eq('referrer_id', referrer);

    expect(error).toBeNull();
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    expect(Number(row?.links_total)).toBe(3);
    // Three signups on one code inside an hour is what `rapid_signup` is for — but these were inserted
    // directly rather than through `link_referral`, so the flag is not set. The count is the signal here.
    expect(Number(row?.referees_without_orders)).toBe(3);

    /*
     * `security_invoker` on the view is what makes this the important half: a view running as its owner
     * would be a way to read `referral_links` and `profiles` with no policy at all.
     */
    const asCustomer = await customer.client.from('referral_fraud_signals').select('referrer_id');
    expect(asCustomer.data ?? []).toEqual([]);
  });
});
