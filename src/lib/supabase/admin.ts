import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env.server';
import type { Database } from '@/lib/supabase/database.types';

/**
 * SERVICE-ROLE CLIENT — bypasses RLS entirely.
 *
 * docs/02 §6 enumerates every legal use, and the list is closed. Adding a caller means
 * adding a row to that table in the same PR:
 *
 *   1. payment webhooks            /api/webhooks/payments/[provider]
 *   2. cron jobs                   /api/cron/*
 *   3. guest cart operations       keyed by `carts.anon_token`
 *   4. guest order lookup          order number + email
 *   5. email dispatch logging      writes to `email_log`
 *   6. auth-user provisioning      seed scripts only
 *
 * It is never a shortcut around a missing policy (CLAUDE.md §5). If a user-context read or
 * write fails, the fix is the policy — not this client.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    },
  );
}
