import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { refreshSession } from '@/lib/supabase/middleware';

/**
 * docs/02 §8 + docs/13 §F1.
 *
 * next-intl's middleware claims every path it is given, which would swallow the deliberately
 * un-localized `/admin` tree (docs/02 §4). So the two concerns are composed by hand rather
 * than chained: the intl middleware runs only on the storefront branch, while the Supabase
 * session refresh runs on *both* — otherwise an admin's session would never be renewed.
 */
const intlMiddleware = createIntlMiddleware(routing);

/** Paths that are never localized. */
const UNLOCALIZED = ['/admin', '/api'];

/** Storefront areas that require a session, matched after the locale prefix is stripped. */
const PROTECTED_STOREFRONT = ['/account'];

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue;
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

/**
 * The locale prefix a path is already carrying, or `''` for the unprefixed default.
 *
 * Redirects must keep it. Sending someone from `/en/account` to `/auth/sign-in` drops them
 * on the Albanian page — they asked for English and we changed the language mid-journey,
 * which reads as a broken site rather than a sign-in prompt.
 */
function localePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (locale === routing.defaultLocale) continue;
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return `/${locale}`;
  }
  return '';
}

function redirectPreservingCookies(request: NextRequest, source: NextResponse, to: URL) {
  const redirect = NextResponse.redirect(to);
  for (const cookie of source.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isUnlocalized = UNLOCALIZED.some((prefix) => pathname.startsWith(prefix));

  // The intl middleware may return a rewrite or a redirect; either way the refreshed auth
  // cookies must land on the response we ultimately return.
  const response = isUnlocalized ? NextResponse.next({ request }) : intlMiddleware(request);

  const user = await refreshSession(request, response);

  if (pathname.startsWith('/admin')) {
    if (!user) {
      // The admin UI is English-only in v1 (docs/01 §3), so its sign-in page is too.
      const signIn = new URL('/en/auth/sign-in', request.url);
      signIn.searchParams.set('next', pathname);
      return redirectPreservingCookies(request, response, signIn);
    }
    // Role enforcement lives in app/admin/layout.tsx plus per-action checks plus RLS
    // (docs/02 §8) — middleware only proves that *someone* is signed in.
    return response;
  }

  const routePath = stripLocale(pathname);
  const needsSession = PROTECTED_STOREFRONT.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
  );

  if (needsSession && !user) {
    const signIn = new URL(`${localePrefix(pathname)}/auth/sign-in`, request.url);
    signIn.searchParams.set('next', pathname);
    return redirectPreservingCookies(request, response, signIn);
  }

  return response;
}

export const config = {
  /**
   * Everything except Next internals and files with an extension. `/api` and `/admin` are
   * intentionally *included* so their sessions refresh; the handler above routes them past
   * the intl middleware.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
