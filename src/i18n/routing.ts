import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/constants';

/**
 * docs/08 §1 — `sq` is the default and is served without a prefix; `en` lives under `/en`.
 * The admin panel is deliberately outside this routing (docs/02 §4) and is excluded from the
 * middleware matcher in `src/middleware.ts`.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  // Locale is derived from the path alone: no Accept-Language redirect, no locale cookie.
  // That keeps `/` deterministic and cacheable for ISR (docs/02 §5) and keeps hreflang and
  // canonical honest. The switcher navigates explicitly; authenticated preference is stored
  // on the profile instead (docs/08 §1).
  localeDetection: false,
  localeCookie: false,
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
