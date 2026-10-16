import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';

/**
 * docs/18 §3.6 — `GET /webhooks/{id}/deliveries`: the last fifty attempts against one endpoint.
 *
 * Status, attempt count, the next scheduled try, the last HTTP status and error. This is the screen a
 * developer looks at when "the webhook is not firing": usually it is, and the endpoint is returning
 * 500 or taking longer than ten seconds.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, { action: 'webhook.deliveries', params: { id } });
}
