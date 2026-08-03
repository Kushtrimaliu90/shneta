'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §6 — the routing decision.
 *
 * Both actions call a security-definer function on the **staff member's own session**, so the
 * function's internal capability check is what authorises the write and this action's
 * `requireCapability` is the second layer. Two checks that agree is not redundancy here: the SQL one
 * holds for any caller including a future cron, and this one gives the UI a message instead of an
 * exception.
 *
 * Neither action touches `order_fulfilments` directly, and that is the point. Assigning is not a status
 * update — it moves a stock reservation between two merchants and recomputes commission — and doing
 * that from TypeScript would mean a non-atomic sequence of writes where a failure halfway leaves one
 * merchant short and the other oversold.
 */

export type RoutingErrorKey =
  | 'admin.errors.forbidden'
  | 'routing.errors.generic'
  | 'routing.errors.invalid'
  | 'routing.errors.cannotCover'
  | 'routing.errors.inProgress'
  | 'routing.errors.notApproved';

export type RoutingState = ActionResult<{ fulfilmentId?: string }, RoutingErrorKey> | null;

function no(error: RoutingErrorKey): RoutingState {
  return fail<RoutingErrorKey, { fulfilmentId?: string }>(error);
}

const assignSchema = z.object({
  fulfilmentId: z.string().uuid(),
  merchantId: z.string().uuid(),
});

const releaseSchema = z.object({
  fulfilmentId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

/** Maps the function's own exceptions onto keys the screen can render. */
function mapError(message: string): RoutingErrorKey {
  if (message.includes('CANDIDATE_CANNOT_COVER')) return 'routing.errors.cannotCover';
  if (message.includes('FULFILMENT_ALREADY_IN_PROGRESS')) return 'routing.errors.inProgress';
  if (message.includes('MERCHANT_NOT_APPROVED')) return 'routing.errors.notApproved';
  if (message.includes('NOT_A_MERCHANT_FULFILMENT')) return 'routing.errors.invalid';
  if (message.includes('FORBIDDEN')) return 'admin.errors.forbidden';
  return 'routing.errors.generic';
}

export async function assignFulfilment(
  _previous: RoutingState,
  formData: FormData,
): Promise<RoutingState> {
  const gate = await requireCapability('routing.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = assignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('routing.errors.invalid');

  const { fulfilmentId, merchantId } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('assign_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_merchant_id: merchantId,
    });

    if (error) {
      logger.error('assignFulfilment failed', { cause: error.message });
      return no(mapError(error.message));
    }

    const result = (data ?? {}) as Record<string, unknown>;

    await audit('fulfilment.assigned', 'order_fulfilment', fulfilmentId, null, {
      merchant_id: merchantId,
      reassigned: result.reassigned ?? false,
      lines_moved: result.lines_moved ?? 0,
      merchant_due_cents: result.merchant_due_cents ?? 0,
    } as unknown as Json);

    revalidatePath('/admin/routing');
    revalidatePath('/merchant/orders');
    return ok({ fulfilmentId });
  } catch (error) {
    logger.error('assignFulfilment threw', describeError(error));
    return no('routing.errors.generic');
  }
}

/**
 * Takes a fulfilment back off a merchant and returns it to the queue.
 *
 * The merchant-facing counterpart of a decline, and the admin-facing answer to a merchant who has gone
 * quiet. The stock reservation goes back with it, because a merchant that ships nothing keeps its
 * stock — leaving it reserved would shrink the stock of whoever was honest about not being able to
 * ship (§6).
 */
export async function releaseFulfilment(
  _previous: RoutingState,
  formData: FormData,
): Promise<RoutingState> {
  const gate = await requireCapability('routing.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('routing.errors.invalid');

  const { fulfilmentId, reason } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('release_fulfilment', {
      p_fulfilment_id: fulfilmentId,
      p_reason: reason ?? undefined,
    });

    if (error) {
      logger.error('releaseFulfilment failed', { cause: error.message });
      return no(mapError(error.message));
    }

    await audit('fulfilment.released', 'order_fulfilment', fulfilmentId, null, {
      reason: reason ?? null,
    } as unknown as Json);

    revalidatePath('/admin/routing');
    revalidatePath('/merchant/orders');
    return ok({ fulfilmentId });
  } catch (error) {
    logger.error('releaseFulfilment threw', describeError(error));
    return no('routing.errors.generic');
  }
}
