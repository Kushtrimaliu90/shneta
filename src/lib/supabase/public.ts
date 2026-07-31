import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { clientEnv } from '@/lib/env.client';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Anon-key client with **no session and no cookies** — RLS still applies, as the anonymous
 * role. For public reads that happen outside a request context.
 *
 * This is a fourth client beyond the three in docs/02 §6, and it exists for a specific
 * reason: `lib/supabase/server.ts` reads `cookies()`, and touching `cookies()` opts the
 * caller into dynamic rendering. That is fatal for exactly the places that must be static:
 *
 *   · `app/sitemap.ts`
 *   · `generateStaticParams` for PDP/PLP/article routes (docs/02 §5)
 *   · any build-time prerender of catalog or content
 *
 * It is strictly *less* privileged than the server client — anonymous rather than the
 * caller's JWT — so it is not a privilege escalation seam. It can only ever read what an
 * anonymous visitor can read. Never use it where the current user matters, and never for
 * writes. Recorded in docs/13 §G.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
