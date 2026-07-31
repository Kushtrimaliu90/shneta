import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env.client';
import type { Database } from '@/lib/supabase/database.types';

/**
 * The default Supabase client (docs/02 §6): anon key + the caller's JWT from cookies,
 * so **RLS applies**. Use this for every RSC read and every server action.
 *
 * Reach for `@/lib/supabase/admin` only for the six cases enumerated in docs/02 §6.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. The session is
            // refreshed by middleware instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}
