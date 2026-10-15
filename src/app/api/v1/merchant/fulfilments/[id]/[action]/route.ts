import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';
import {
  fulfilmentDeclineBodySchema,
  fulfilmentShipBodySchema,
} from '@/features/merchants/api/schemas';
import { afterFulfilmentTransition } from '@/features/merchants/api/fulfilment-side-effects';

/**
 * docs/18 §3.4 — the merchant's lane, four verbs:
 *
 *   POST /fulfilments/{id}/accept
 *   POST /fulfilments/{id}/pack
 *   POST /fulfilments/{id}/ship      { carrier, tracking_code }
 *   POST /fulfilments/{id}/decline   { reason }
 *
 * Each posts a status and lets `guard_fulfilment_transition` judge it, exactly as the portal does
 * (docs/16 §7). A move the lane does not allow — shipping something not yet packed, accepting what
 * was already accepted — is `409 wrong_state`. `delivered` is not a verb here and never will be:
 * the courier's word is BioCode's to record, because a merchant that could mark its own parcels
 * delivered could trigger its own payout.
 *
 * After a decline the fulfilment is released back to the routing queue; after every move the ops
 * alert goes out. Both are side effects of a transition that has already committed, so they run
 * in `after` and cannot fail the response.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

const VERBS = {
  accept: { action: 'fulfilment.accept', status: 'accepted' },
  pack: { action: 'fulfilment.pack', status: 'packed' },
  ship: { action: 'fulfilment.ship', status: 'shipped' },
  decline: { action: 'fulfilment.decline', status: 'cancelled' },
} as const;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);

  const verb = (Object.keys(VERBS) as Array<keyof typeof VERBS>).find((key) => key === action);
  if (!verb) return apiError('not_found', 404);
  const { action: execAction, status } = VERBS[verb];

  if (verb === 'ship') {
    return runMerchantApi(request, {
      action: execAction,
      body: fulfilmentShipBodySchema,
      params: { id },
      after: () => afterFulfilmentTransition(id, status),
    });
  }

  if (verb === 'decline') {
    let reason = '';
    return runMerchantApi(request, {
      action: execAction,
      body: fulfilmentDeclineBodySchema.transform((value) => {
        reason = value.reason;
        return value;
      }),
      params: { id },
      after: () => afterFulfilmentTransition(id, status, reason),
    });
  }

  return runMerchantApi(request, {
    action: execAction,
    params: { id },
    after: () => afterFulfilmentTransition(id, status),
  });
}
