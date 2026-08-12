import 'server-only';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { getProfile } from '@/features/auth/queries';
import { can, isStaff, type Capability } from '@/features/admin/roles';

/**
 * docs/06 preamble — **every** admin mutation writes `audit_logs`, re-checks the role
 * server-side, and reaches the audit trail through `log_audit`.
 *
 * Both halves live here because they are the same discipline and separating them is how one
 * gets forgotten. `requireCapability` returns the actor, and `audit` needs an actor, so the
 * natural way to write an action is the correct way:
 *
 *   const actor = await requireCapability('orders.refund');
 *   if (!actor.ok) return actor.error;
 *   … do the work …
 *   await audit('order.refund', 'order', id, before, after);
 */

/** The audited actor. Narrow on purpose — an action needs the id and role, nothing more. */
export interface Actor {
  id: string;
  role: string;
  email: string;
}

export type AdminErrorKey = 'admin.errors.forbidden' | 'admin.errors.generic';

/**
 * Proves the caller may do this, before anything is written.
 *
 * The middleware only established that *someone* is signed in and the layout only decided
 * whether to render a page — neither is a permission check on a mutation, and a server action
 * is reachable by POST without ever loading the page that hosts its form. So this runs inside
 * every action, and RLS still backs it up (docs/02 §8, defence in depth).
 *
 * Hands back the bare message key rather than a finished `ActionResult`, because each action
 * has its own narrowed error union and needs to widen this into it:
 *
 *   const gate = await requireCapability('orders.refund');
 *   if (!gate.ok) return fail<OrderErrorKey>(gate.error);
 */
export async function requireCapability(
  capability: Capability,
): Promise<{ ok: true; actor: Actor } | { ok: false; error: 'admin.errors.forbidden' }> {
  const profile = await getProfile();

  if (!profile || !isStaff(profile.role) || !can(profile.role, capability)) {
    /*
     * Logged at info, not warn: the ordinary cause is a stale tab belonging to someone whose
     * role changed, not an attack. It is recorded either way, because a burst of these is
     * worth seeing — and deliberately *not* written to `audit_logs`, which is a log of things
     * that happened, not of things that were refused.
     */
    logger.info('Admin capability denied', {
      capability,
      role: profile?.role ?? 'anonymous',
    });
    return { ok: false, error: 'admin.errors.forbidden' };
  }

  return { ok: true, actor: { id: profile.id, role: profile.role, email: profile.email } };
}

/**
 * Writes one audit row through the `log_audit` RPC.
 *
 * The RPC rather than a direct insert because `audit_logs` has **no insert policy** — with RLS
 * enabled that means denied, deliberately (docs/13 §B5). `log_audit` is security definer, so
 * it can write while still refusing a non-staff caller, and it stamps `actor_id` and
 * `actor_role` from `auth.uid()` rather than from anything the caller passes. An actor cannot
 * forge who did something.
 *
 * Through the **SSR client**, not the service client: `auth.uid()` has to resolve to the
 * signed-in staff member. The service client would write `actor_id = null` and lose the one
 * fact the row exists to record.
 *
 * Never throws. An audit write failing must not roll back a shipment that already went out or
 * a refund already issued — the operator would retry and double-refund. It logs at error
 * level so the gap is visible, which is the honest trade: a missing audit row is a problem,
 * a duplicated refund is a worse one.
 */
export async function audit(
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
): Promise<void> {
  try {
    const supabase = await createClient();

    // Forwarded first: Vercel puts the real client address in `x-forwarded-for`, and
    // `x-real-ip` is the fallback for other proxies. Only the first hop is meaningful.
    const headerBag = await headers();
    const ip =
      headerBag.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerBag.get('x-real-ip') ?? null;

    const { error } = await supabase.rpc('log_audit', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId ?? undefined,
      p_before: (before ?? undefined) as never,
      p_after: (after ?? undefined) as never,
      p_ip: ip ?? undefined,
    });

    if (error) {
      logger.error('Audit write failed', { action, entityType, entityId, cause: error.message });
    }
  } catch (error) {
    logger.error('Audit write threw', { action, entityType, ...describeError(error) });
  }
}

export interface AuditRow {
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * One audit row per entity, written in a single round trip.
 *
 * For a bulk decision, where twenty rows decided is twenty decisions to record. The action name stays
 * the singular one — `offer.approved`, not `offer.bulk_approved` — so "every decision ever made about
 * this offer" remains one query on `entity_id`. The grouping instead rides in each row's `after` as a
 * shared `bulk_id`, which the caller supplies.
 *
 * Never throws, for the same reason `audit` does not: a failed audit write must not undo work that has
 * already happened and been announced.
 *
 * ── The fallback, and why it is worth the code ──
 *
 * A single swallowed batch write means *zero* audit rows for a twenty-row decision, visible only in the
 * log. So a failure here retries the same rows one at a time through `audit()`, which is a different
 * function and a different statement: losing the trail then takes two independent failures rather than
 * one. The caps on this feature (25) keep that fallback bounded.
 */
export async function auditMany(
  action: string,
  entityType: string,
  rows: AuditRow[],
): Promise<void> {
  if (rows.length === 0) return;

  try {
    const supabase = await createClient();

    const headerBag = await headers();
    const ip =
      headerBag.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerBag.get('x-real-ip') ?? null;

    const { error } = await supabase.rpc('log_audit_many', {
      p_action: action,
      p_entity_type: entityType,
      p_rows: rows.map((row) => ({
        entity_id: row.entityId,
        before: row.before ?? null,
        after: row.after ?? null,
      })) as never,
      p_ip: ip ?? undefined,
    });

    if (!error) return;

    logger.error('Bulk audit write failed; falling back to one row at a time', {
      action,
      entityType,
      count: rows.length,
      ids: rows.map((row) => row.entityId).join(','),
      cause: error.message,
    });
  } catch (error) {
    logger.error('Bulk audit write threw; falling back to one row at a time', {
      action,
      entityType,
      count: rows.length,
      ...describeError(error),
    });
  }

  for (const row of rows) {
    await audit(action, entityType, row.entityId, row.before ?? null, row.after ?? null);
  }
}
