import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';

/**
 * docs/18 §3.6 — `POST /webhooks/{id}/ping`: queue a `ping` event for this endpoint.
 *
 * Delivered by the next cron run regardless of what the endpoint subscribed to, because a ping is
 * how you find out the endpoint works at all. The response names the delivery, so its outcome can be
 * read from `GET /webhooks/{id}/deliveries`.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, { action: 'webhook.ping', params: { id } });
}
