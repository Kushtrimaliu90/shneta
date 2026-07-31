import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { clientEnv } from '@/lib/env.client';
import { logger } from '@/lib/logger';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Per-request session refresh (docs/02 §8). Refreshed cookies are written onto `response`,
 * which the caller then returns — including when that response is a redirect or an
 * intl rewrite, so the refreshed session survives either branch.
 *
 * A Supabase outage must not 500 the storefront: failures degrade to "unauthenticated",
 * which is the safe default because every guard denies on null.
 */
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<User | null> {
  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  try {
    // getUser() revalidates the JWT against the auth server. getSession() only decodes the
    // cookie and must never be trusted for authorization decisions.
    const { data } = await supabase.auth.getUser();
    return data.user;
  } catch (error) {
    logger.warn('Session refresh failed; treating request as unauthenticated', {
      path: request.nextUrl.pathname,
      cause: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
