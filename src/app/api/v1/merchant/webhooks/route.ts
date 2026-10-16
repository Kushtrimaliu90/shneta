import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { webhookCreateBodySchema } from '@/features/merchants/api/schemas';
import { generateWebhookSecret } from '@/features/merchants/api-keys';

/**
 * docs/18 §3.6 — webhook endpoints.
 *
 *   GET   every endpoint this merchant registered, without secrets.
 *   POST  { url, events, description? } → the endpoint **with its signing secret, shown once**.
 *
 * The secret is minted here, in the app, and handed to the SQL with the body — the same division as
 * API keys, where the app holds the random source and the database holds the record. Five endpoints
 * per merchant, https only, events from the fixed list in `scopes.ts`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'webhooks' });
}

export async function POST(request: NextRequest) {
  return runMerchantApi(request, {
    action: 'webhook.create',
    body: webhookCreateBodySchema,
    params: { secret: generateWebhookSecret() },
  });
}
