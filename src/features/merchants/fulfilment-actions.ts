'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getMyMerchant } from '@/features/merchants/queries';

/**
 * docs/16 §7 — the merchant's lane: accept, decline, pack, ship.
 *
 * ── Where the boundary actually is ──
 *
 * `guard_fulfilment_transition` is the authority on which moves are legal, and it is written against
 * the merchant's own session. So these actions post a status and let the trigger judge it, rather than
 * re-implementing the state machine in TypeScript where it could drift from the one that is enforced.
 *
 * The four moves a merchant owns: `assigned → accepted`, `assigned → cancelled` (declining),
 * `accepted → packed`, `packed → shipped`. **`delivered` is absent and must stay absent** — courier
 * confirmation is BioCode's to record, because a merchant that could mark its own parcels delivered
 * could trigger its own payout (§7).
 *
 * Timestamps are not posted either: `fulfilments_stamp_timestamps` sets them, so a merchant cannot
 * backdate an SLA it is measured against.
 */

export type FulfilmentErrorKey =
  | 'merchant.fulfilments.errors.generic'
  | 'merchant.fulfilments.errors.invalid'
  | 'merchant.fulfilments.errors.notMerchant'
  | 'merchant.fulfilments.errors.notYours'
  | 'merchant.fulfilments.errors.wrongState'
  | 'merchant.fulfilments.errors.trackingRequired';

export type FulfilmentState = ActionResult<{ fulfilmentId?: string }, FulfilmentErrorKey> | null;

function no(error: FulfilmentErrorKey): FulfilmentState {
  return fail<FulfilmentErrorKey, { fulfilmentId?: string }>(error);
}

const idSchema = z.object({ fulfilmentId: z.string().uuid() });

const shipSchema = z.object({
  fulfilmentId: z.string().uuid(),
  /**
   * Carrier and tracking are required to ship, and that is a product decision rather than a schema
   * one: the columns are nullable because a pre-marketplace shipment has neither. A merchant marking
   * something shipped with no way for the customer to find it is a support ticket waiting to happen.
   */
  carrier: z.string().trim().min(2, 'required').max(80),
  trackingCode: z.string().trim().min(3, 'required').max(120),
});

const declineSchema = z.object({
  fulfilmentId: z.string().uuid(),
  /** Required: a decline with no reason is one nobody can learn from, and the scorecard reads it. */
  reason: z.string().trim().min(5, 'required').max(500),
});

/** The merchant acting, or a refusal. */
async function actingMerchant(): Promise<
  { ok: true; id: string } | { ok: false; error: FulfilmentErrorKey }
> {
  const merchant = await getMyMerchant();
  if (!merchant) return { ok: false, error: 'merchant.fulfilments.errors.notMerchant' };
  if (merchant.status !== 'approved') {
    return { ok: false, error: 'merchant.fulfilments.errors.notMerchant' };
  }
  return { ok: true, id: merchant.id };
}

/**
 * Moves a fulfilment along the merchant's lane.
 *
 * The `.select()` after the update is what distinguishes "the trigger refused" from "no row matched":
 * the update policy restricts to `assigned`, `accepted` and `packed`, so a fulfilment in any other
 * state matches **zero rows and returns no error** (docs/13 §N7). An action that only checked `error`
 * would report success for a write that did nothing.
 */
async function transition(
  fulfilmentId: string,
  merchantId: string,
  status: 'accepted' | 'packed' | 'shipped' | 'cancelled',
  extra: Record<string, string> = {},
): Promise<FulfilmentState> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('order_fulfilments')
    .update({ status, ...extra })
    .eq('id', fulfilmentId)
    .eq('merchant_id', merchantId)
    .select('id, status')
    .maybeSingle();

  if (error) {
    if (error.message.includes('FULFILMENT_TRANSITION_FORBIDDEN')) {
      return no('merchant.fulfilments.errors.wrongState');
    }
    if (error.message.includes('FULFILMENT_FIELD_FORBIDDEN')) {
      return no('merchant.fulfilments.errors.invalid');
    }
    logger.error('fulfilment transition failed', { cause: error.message, status });
    return no('merchant.fulfilments.errors.generic');
  }
  if (!data) return no('merchant.fulfilments.errors.wrongState');

  revalidatePath('/merchant/orders');
  revalidatePath(`/merchant/orders/${fulfilmentId}`);
  revalidatePath('/merchant');
  revalidatePath('/admin/routing');
  return ok({ fulfilmentId });
}

export async function acceptFulfilment(
  _previous: FulfilmentState,
  formData: FormData,
): Promise<FulfilmentState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.fulfilments.errors.invalid');

  try {
    return await transition(parsed.data.fulfilmentId, acting.id, 'accepted');
  } catch (error) {
    logger.error('acceptFulfilment threw', describeError(error));
    return no('merchant.fulfilments.errors.generic');
  }
}

export async function markFulfilmentPacked(
  _previous: FulfilmentState,
  formData: FormData,
): Promise<FulfilmentState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.fulfilments.errors.invalid');

  try {
    return await transition(parsed.data.fulfilmentId, acting.id, 'packed');
  } catch (error) {
    logger.error('markFulfilmentPacked threw', describeError(error));
    return no('merchant.fulfilments.errors.generic');
  }
}

/**
 * Ships it, with a carrier and a tracking code.
 *
 * The transition to `shipped` is what makes the order `partially_shipped` or `shipped`, through
 * `sync_order_status_from_fulfilments` — a trigger rather than a call here, because the same
 * transition arrives from BioCode's own shipment action and from a cron, and the third caller is the
 * one that forgets (§7).
 */
export async function shipFulfilment(
  _previous: FulfilmentState,
  formData: FormData,
): Promise<FulfilmentState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = shipSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.fulfilments.errors.trackingRequired');

  try {
    return await transition(parsed.data.fulfilmentId, acting.id, 'shipped', {
      carrier: parsed.data.carrier,
      tracking_code: parsed.data.trackingCode,
    });
  } catch (error) {
    logger.error('shipFulfilment threw', describeError(error));
    return no('merchant.fulfilments.errors.generic');
  }
}

/**
 * Declines a fulfilment, returning it to the routing queue.
 *
 * Two steps, and the second one needs privilege the merchant does not have: the merchant moves its own
 * row to `cancelled` (which the guard permits from `assigned`), and then `release_fulfilment` returns
 * the stock reservation and puts the row back to `unassigned` so an admin can route it elsewhere.
 *
 * **The service client is used for that second step, and it belongs on the docs/02 §6 list.** The
 * function is staff-gated on purpose — it moves stock and money — and a merchant declining is the one
 * legitimate case of a non-staff actor needing it to run. What keeps that safe is that the merchant's
 * own transition has already succeeded under RLS: the privileged call happens only for a row this
 * merchant was assigned and has just declined, and it is passed nothing but that row's id.
 */
export async function declineFulfilment(
  _previous: FulfilmentState,
  formData: FormData,
): Promise<FulfilmentState> {
  const acting = await actingMerchant();
  if (!acting.ok) return no(acting.error);

  const parsed = declineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.fulfilments.errors.invalid');

  const { fulfilmentId, reason } = parsed.data;

  try {
    const declined = await transition(fulfilmentId, acting.id, 'cancelled', {
      cancel_reason: reason,
    });
    if (!declined?.ok) return declined;

    const admin = createAdminClient();
    const { error } = await admin.rpc('release_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_reason: reason,
    });

    if (error) {
      /*
       * The decline stands even if the release fails — the merchant has said no, and that is recorded.
       * What is left is a cancelled fulfilment an admin has to re-route by hand, which is visible on
       * `/admin/routing` with `include_assigned`, so it is a loud failure rather than a lost order.
       */
      logger.error('release after decline failed', { fulfilmentId, cause: error.message });
    }

    revalidatePath('/admin/routing');
    return ok({ fulfilmentId });
  } catch (error) {
    logger.error('declineFulfilment threw', describeError(error));
    return no('merchant.fulfilments.errors.generic');
  }
}
