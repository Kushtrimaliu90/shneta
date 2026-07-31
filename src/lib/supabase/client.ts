import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env.client';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Browser client (docs/02 §6) — anon key, RLS applies. Rare by design: only client
 * components that genuinely need realtime or live auth state. Mutations never go through
 * here; they go through server actions (CLAUDE.md §4).
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
