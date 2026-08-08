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
/**
 * Is there anything to refresh?
 *
 * `@supabase/ssr` stores the session in cookies named `sb-<project-ref>-auth-token`, chunked as
 * `.0`, `.1`, … when the JWT is long. No such cookie means no session, and `getUser()` on a request
 * carrying none is a network round-trip to the auth server whose only possible answer is `null`.
 *
 * Prefix-matched rather than reconstructed from the project ref: the ref would have to be parsed out
 * of the Supabase URL, and a mismatch there would silently skip the refresh for *signed-in* users —
 * a much worse failure than the one this avoids.
 */
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
}

export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
): Promise<User | null> {
  /*
   * The single largest saving in the 8 Aug 2026 cost work.
   *
   * This ran on every request the matcher admitted — every page view, every crawler fetch, every
   * `/api` call — and each one built an SSR client and asked the auth server to validate a JWT that,
   * for an anonymous visitor, was not there. Fluid Active CPU was the top line on the bill at $2.44,
   * and this is a network wait inside a billed function on a shop whose visitors are almost entirely
   * anonymous.
   *
   * Returning `null` early is not a weaker guarantee: with no auth cookie, `getUser()` returns `null`
   * too, so every downstream check — the `/admin` redirect, `needsSession`, and RLS underneath both —
   * reaches the same decision by the same route. Nothing is cached and no cookie is written, so a
   * visitor who signs in gets the full path on their very next request.
   */
  if (!hasAuthCookie(request)) return null;

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
