import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';

/**
 * docs/18 §3.4 — `GET /fulfilments/{id}`: one fulfilment, through `merchant_fulfilment_view`.
 *
 * The only read path from a merchant into order data (docs/16 §3): a fixed shape with the lines, the
 * delivery method, this fulfilment's own subtotal and COD amount, and the customer's name, phone and
 * address **once the fulfilment is assigned** and not before. Somebody else's id is a 404, never a 403.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, { action: 'fulfilment', params: { id } });
}
