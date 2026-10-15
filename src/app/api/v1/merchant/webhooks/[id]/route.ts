import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { apiError } from '@/features/merchants/api/respond';
import { webhookUpdateBodySchema } from '@/features/merchants/api/schemas';

/**
 * docs/18 §3.6 — one endpoint.
 *
 *   PATCH   { url?, events?, description?, status? } — `status: "active"` re-enables one the cron
 *           switched off after too many failures; `"disabled"` pauses it without losing the config.
 *   DELETE  removes it and every delivery queued or recorded for it.
 */
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, {
    action: 'webhook.update',
    body: webhookUpdateBodySchema,
    params: { id },
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return apiError('not_found', 404);
  return runMerchantApi(request, { action: 'webhook.delete', params: { id } });
}
