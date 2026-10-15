import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/18 §5 — the keys table on `/merchant/api`.
 *
 * Reads through the SSR client, so `p_own_read` scopes it to the caller's merchant. The hash is never
 * selected: it is not secret in the way the token is, but there is no screen that needs it, and a
 * column nobody renders is a column that cannot end up in a React prop by accident.
 */

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  scopes: string[];
}

export async function listMyApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('merchant_api_keys')
    .select('id, name, key_prefix, created_at, last_used_at, revoked_at, scopes')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error('listMyApiKeys failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    scopes: row.scopes,
  }));
}
