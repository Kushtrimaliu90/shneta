import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { refreshSession } from '@/lib/supabase/middleware';
import { UNLOCALIZED, localePrefix, stripLocale, unlocalizedTarget } from '@/lib/route-locale';

/**
 * docs/02 §8 + docs/13 §F1.
 *
 * next-intl's middleware claims every path it is given, which would swallow the deliberately
 * un-localized `/admin` tree (docs/02 §4). So the two concerns are composed by hand rather
 * than chained: the intl middleware runs only on the storefront branch, while the Supabase
 * session refresh runs on *both* — otherwise an admin's session would never be renewed.
 */
const intlMiddleware = createIntlMiddleware(routing);

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
   * Before anything else, and before the session refresh: the target goes through this middleware
   * again on the next hop and refreshes there, so there is nothing to carry across.
   *
   * 307 and not 308. The admin panel is English-only *in v1* (docs/01 §3), and a permanent redirect is
   * cached by the browser indefinitely — if admin is ever localized, everyone who had once typed
   * `/en/admin` would be bounced away from it by their own cache.
   */
  const target = unlocalizedTarget(pathname);
  if (target) {
    const to = new URL(target, request.url);
    to.search = request.nextUrl.search;
    return NextResponse.redirect(to, 307);
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
