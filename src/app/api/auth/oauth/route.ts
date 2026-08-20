import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env.client';
import type { Database } from '@/lib/supabase/database.types';
import { isOAuthProvider, oauthRedirectUrl } from '@/features/auth/oauth';
import { limitByIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * Starts a social sign-in (docs/05 §15). `GET /api/auth/oauth?provider=google&next=/account`.
 *
 * A GET route reached by an anchor, not a button — see `features/auth/oauth.ts` for why (CSP
 * `form-action`, and working before hydration).
 *
 * ── Why this builds its own Supabase client instead of using `lib/supabase/server` ──
 *
 * `signInWithOAuth` does not just return a URL: it generates the PKCE **code verifier** and hands it
 * to the cookie adapter. `/api/auth/callback` then needs that exact cookie to redeem the code, so if
 * it fails to reach the browser the entire flow ends at "link_invalid" with nothing in the logs to
 * say why.
 *
 * `lib/supabase/server` writes through `cookies()` from `next/headers`, which it deliberately wraps in
 * a `try {} catch {}` because it is shared with Server Components where cookies are read-only. That
 * swallow is correct there and unacceptable here. Writing straight onto the redirect response makes
 * the hand-off explicit and impossible to lose silently.
 *
 * `/api` is in the middleware's `UNLOCALIZED` list, so this path is never rewritten to `/sq/api/...`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const provider = searchParams.get('provider');
  const next = searchParams.get('next');

  const signInUrl = new URL('/auth/sign-in', origin);

  if (!isOAuthProvider(provider)) {
    logger.info('OAuth start rejected: unknown provider', { provider });
    signInUrl.searchParams.set('error', 'oauth');
    return NextResponse.redirect(signInUrl);
  }

  /*
   * Rate limited because this is an unauthenticated GET that costs a Supabase round trip and sets a
   * cookie. Not a security boundary — see `lib/rate-limit` on failing open — just a brake on a
   * prefetcher or a script hammering it.
   */
  if (!(await limitByIp('oauthStart', request.headers))) {
    signInUrl.searchParams.set('error', 'rate');
    return NextResponse.redirect(signInUrl);
  }

  /*
   * Built first, so the client below has somewhere real to write the PKCE cookie onto.
   * `NextResponse.redirect` needs its final URL up front, which is why the failure branches above
   * return their own responses rather than mutating this one.
   */
  const response = NextResponse.redirect(signInUrl);

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
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: oauthRedirectUrl(clientEnv.NEXT_PUBLIC_SITE_URL, next),
      /*
       * We do the redirecting. Without this the SDK tries to navigate the *server*, which is not a
       * browser, and returns no URL for us to forward to.
       */
      skipBrowserRedirect: true,
      queryParams: {
        /*
         * Ask Google which account, every time.
         *
         * Without it Google silently reuses the single signed-in session, so a shared machine — a
         * phone in a family, a laptop in a shop, which is a large share of this market — signs the
         * second person into the first person's BioCode account with no visible choice. That is a
         * privacy failure, and it looks like a bug in our shop rather than a Google default.
         */
        prompt: 'select_account',
      },
    },
  });

  if (error || !data?.url) {
    logger.warn('OAuth start failed', { provider, reason: error?.message ?? 'no url returned' });
    signInUrl.searchParams.set('error', 'oauth');
    return NextResponse.redirect(signInUrl);
  }

  /*
   * `NextResponse.redirect` cannot be re-pointed after construction, so the real redirect is a new
   * response — and the PKCE cookies the client just set have to be copied onto it by hand. Losing
   * them here is exactly the silent failure this file's header warns about.
   */
  const outbound = NextResponse.redirect(data.url);
  for (const cookie of response.cookies.getAll()) outbound.cookies.set(cookie);
  return outbound;
}
