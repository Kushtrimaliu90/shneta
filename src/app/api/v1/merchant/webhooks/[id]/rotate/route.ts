import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';
import { generateWebhookSecret } from '@/features/merchants/api-keys';

/**
 * docs/18 §3.6 — `POST /webhooks/{id}/rotate`: a new signing secret, shown once.
 *
 * Takes effect immediately: deliveries claimed after this call are signed with the new secret, so
 * the receiver should be updated first and then this called — the reverse order drops whatever is
 * delivered in between.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, {
    action: 'webhook.rotate',
    params: { id, secret: generateWebhookSecret() },
  });
}
