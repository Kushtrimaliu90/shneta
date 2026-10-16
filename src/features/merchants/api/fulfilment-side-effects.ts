import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { sendFulfilmentOpsAlert } from '@/features/merchants/email';

/**
 * docs/18 §3.4 — what happens after a merchant moves a fulfilment through the API.
 *
 * The transition itself ran inside `merchant_api_exec` as the merchant, judged by
 * `guard_fulfilment_transition`. Two things follow it, exactly as they follow the portal action:
 *
 *   · **The ops alert.** The merchant acting is the event the admin needs to hear about — shipped
 *     gates the customer's dispatch email, cancelled needs re-routing (owner, 2026-09-01).
 *   · **The release, after a decline.** `release_fulfilment` returns the stock reservation and puts
 *     the row back to `unassigned` so an admin can route it elsewhere. It is staff-gated on purpose —
 *     it moves stock and money — and the merchant declining is the one legitimate case of a non-staff
 *     actor needing it to run. The service client is used for that step and that step only, after the
 *     merchant's own transition has already succeeded; it is passed nothing but the row's id. This is
 *     the same entry as `merchants/fulfilment-actions.ts` in docs/02 §6.
 *
 * Both are fire-and-forget with their own catch: a mail or release failure must not fail a transition
 * that already committed. A failed release leaves a cancelled fulfilment an admin re-routes by hand,
 * visible on `/admin/routing` with `include_assigned` — a loud failure rather than a lost order.
 */
export async function afterFulfilmentTransition(
  fulfilmentId: string,
  status: 'accepted' | 'packed' | 'shipped' | 'cancelled',
  reason?: string,
): Promise<void> {
  if (status === 'cancelled') {
    const admin = createAdminClient();
    const { error } = await admin.rpc('release_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_reason: reason,
    });
    if (error) {
      logger.error('release after api decline failed', { fulfilmentId, cause: error.message });
    }
  }

  await sendFulfilmentOpsAlert(fulfilmentId, status).catch((cause: unknown) => {
    logger.error('fulfilment ops alert failed', describeError(cause));
  });
}
