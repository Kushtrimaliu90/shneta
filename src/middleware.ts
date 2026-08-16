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
const PROTECTED_STOREFRONT = ['/account', '/merchant'];

/**
 * Public exceptions inside an otherwise protected area (docs/16 §4).
 *
 * `/merchant/apply` is the onboarding form and has to be reachable by somebody who does not yet
 * have an account — that is the entire point of it. Matched exactly rather than by prefix, so a
 * future `/merchant/apply/secret` cannot inherit the exemption.
 *
 * Note what is **not** here: the public seller page lives at `/seller/[slug]`, not under
 * `/merchant`. docs/16 §5 and §9 put the portal and the public page in the same namespace, which
 * collides — `/merchant/orders` and `/merchant/some-slug` cannot both resolve. Keeping the portal to
 * fixed segments and moving the public page out means no dynamic segment ever sits beside a portal
 * route, so no future page name can be mistaken for a merchant slug.
 */
const PUBLIC_EXCEPTIONS = ['/merchant/apply'];

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

  /*
   * TEMPORARY — traffic identification, 17 Aug 2026. Remove once the source is known.
   *
   * The site is taking ~21 requests a second with no customers, costing ~$10/day, and Vercel's log stream
   * carries no user agent or client IP. It does carry a function's own `console` output, so this is the one
   * way to see who is calling without guessing. One line, one request in fifty, so the logging cannot itself
   * become the cost.
   */
  if (process.env.TRAFFIC_PROBE === 'on' && Math.random() < 0.02) {
    console.warn(
      JSON.stringify({
        probe: 'ua',
        path: pathname,
        ua: request.headers.get('user-agent')?.slice(0, 160) ?? '(none)',
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '(none)',
        ref: request.headers.get('referer')?.slice(0, 120) ?? '(none)',
        country: request.headers.get('x-vercel-ip-country') ?? '(none)',
        accept: request.headers.get('accept')?.slice(0, 60) ?? '(none)',
      }),
    );
  }

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
  const needsSession =
    !PUBLIC_EXCEPTIONS.includes(routePath) &&
    PROTECTED_STOREFRONT.some(
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
