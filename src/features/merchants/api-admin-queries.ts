import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/18 §5 — what the admin screen reads: every merchant's keys and webhook endpoints.
 *
 * Through the SSR client, so `p_staff_read` on both tables is what admits the caller — a support
 * agent sees the same rows an admin does, and the buttons are what `merchants.manage` gates. The key
 * hash and the webhook secret are never selected: no screen needs them, and a column nobody renders
 * cannot end up in a React prop by accident.
 */

export interface AdminApiKeyRow {
  id: string;
  merchantId: string;
  merchantName: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AdminWebhookRow {
  id: string;
  merchantId: string;
  merchantName: string;
  url: string;
  events: string[];
  description: string | null;
  status: 'active' | 'disabled';
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  /** Over the last 200 deliveries across all endpoints, so a stuck queue is visible on the list. */
  pending: number;
  failed: number;
}

export type AdminKeyFilter = 'active' | 'revoked';

export async function listAllApiKeys(filter: AdminKeyFilter): Promise<AdminApiKeyRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from('merchant_api_keys')
    .select(
      'id, merchant_id, name, key_prefix, scopes, created_at, last_used_at, revoked_at, merchants ( display_name )',
    )
    .order('created_at', { ascending: false })
    .limit(500);

  query = filter === 'active' ? query.is('revoked_at', null) : query.not('revoked_at', 'is', null);

  const { data, error } = await query;
  if (error) {
    logger.error('listAllApiKeys failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as unknown as Array<{
      id: string;
      merchant_id: string;
      name: string;
      key_prefix: string;
      scopes: string[];
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
      merchants: { display_name: string } | null;
    }>
  ).map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.display_name ?? '—',
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function listAllWebhooks(): Promise<AdminWebhookRow[]> {
  const supabase = await createClient();
  const [hooks, deliveries] = await Promise.all([
    supabase
      .from('merchant_webhooks')
      .select(
        'id, merchant_id, url, events, description, status, consecutive_failures, disabled_reason, created_at, merchants ( display_name )',
      )
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('merchant_webhook_deliveries')
      .select('webhook_id, status')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (hooks.error) {
    logger.error('listAllWebhooks failed', { cause: hooks.error.message });
    return [];
  }
  if (deliveries.error) {
    logger.error('listAllWebhooks deliveries failed', { cause: deliveries.error.message });
  }

  const pending = new Map<string, number>();
  const failed = new Map<string, number>();
  for (const row of deliveries.data ?? []) {
    const bucket = row.status === 'pending' ? pending : row.status === 'failed' ? failed : null;
    if (bucket) bucket.set(row.webhook_id, (bucket.get(row.webhook_id) ?? 0) + 1);
  }

  return (
    (hooks.data ?? []) as unknown as Array<{
      id: string;
      merchant_id: string;
      url: string;
      events: string[];
      description: string | null;
      status: string;
      consecutive_failures: number;
      disabled_reason: string | null;
      created_at: string;
      merchants: { display_name: string } | null;
    }>
  ).map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.display_name ?? '—',
    url: row.url,
    events: row.events,
    description: row.description,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    consecutiveFailures: row.consecutive_failures,
    disabledReason: row.disabled_reason,
    createdAt: row.created_at,
    pending: pending.get(row.id) ?? 0,
    failed: failed.get(row.id) ?? 0,
  }));
}
