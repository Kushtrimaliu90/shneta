import { DEFAULT_LOCALE, LOCALES } from '@/lib/constants';

/**
 * Locale-prefix arithmetic for `src/middleware.ts`, kept here as pure string functions.
 *
 * Separate from the middleware itself so it can be tested: importing `middleware.ts` drags in
 * `next-intl/middleware`, which cannot resolve `next/server` outside a Next runtime. Depending only on
 * `@/lib/constants` — the same place `i18n/routing.ts` takes its locales from — keeps this a leaf.
 */

/** Paths that are never localized (docs/02 §4). */
export const UNLOCALIZED = ['/admin', '/api'];

/** Everything after the locale prefix, so route rules can be written once per path. */
export function stripLocale(pathname: string): string {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

/**
 * The locale prefix a path is already carrying, or `''` for the unprefixed default.
 *
 * Redirects must keep it. Sending someone from `/en/account` to `/auth/sign-in` drops them on the
 * Albanian page — they asked for English and we changed the language mid-journey, which reads as a
 * broken site rather than a sign-in prompt.
 */
export function localePrefix(pathname: string): string {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return `/${locale}`;
  }
  return '';
}

/**
 * Where a locale-prefixed request for an un-localized route should actually go — `/en/admin` to
 * `/admin` — or `null` when the path has nothing to do with this.
 *
 * `/admin` and `/api` live outside `[locale]` on purpose, so the intl middleware rewrote `/en/admin`
 * to `[locale]/admin`, which does not exist, and it fell through to the catch-all as a **404**.
 * Reported from real use: somebody browsing the shop in English types the admin URL the way every
 * other page on the site looks, and the panel appears to be missing.
 *
 * The inconsistency is what makes it a bug rather than a quirk. `/sq/admin` already redirected to
 * `/admin`, because `localePrefix: 'as-needed'` has next-intl strip the default locale — so the same
 * URL shape worked in Albanian and 404'd in English.
 *
 * Written over `UNLOCALIZED` rather than against `/admin` alone: that array is already the single
 * statement of which routes are never localized, and `/en/api/health` had the identical hole.
 *
 * Matching is segment-aware. `/en/administrators` is an ordinary storefront path that happens to begin
 * with "admin", and rewriting it to `/administrators` would break a real page.
 */
export function unlocalizedTarget(pathname: string): string | null {
  const prefix = localePrefix(pathname);
  if (!prefix) return null;

  const stripped = pathname.slice(prefix.length) || '/';
  const isUnlocalized = UNLOCALIZED.some(
    (route) => stripped === route || stripped.startsWith(`${route}/`),
  );
  return isUnlocalized ? stripped : null;
}
