import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { fulfilmentsQuerySchema } from '@/features/merchants/api/schemas';

/**
 * docs/18 §3.4 — `GET /fulfilments?status=assigned`: the merchant's orders, as summaries.
 *
 * The same `merchant_fulfilment_list` the portal reads: order number, line and unit counts, the
 * money this fulfilment carries, and the COD amount to expect. **No address, no customer, no order
 * total** — those are on the single-fulfilment view, and the address only once it is assigned
 * (docs/16 §3).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'fulfilments', query: fulfilmentsQuerySchema });
}
