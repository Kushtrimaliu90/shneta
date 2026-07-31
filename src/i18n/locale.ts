import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import type { Locale } from '@/lib/constants';

/**
 * Narrows the `[locale]` route param to the `Locale` union.
 *
 * Next types route params as `string`, but every next-intl API (and every `pickLocale`
 * call) wants the union. Doing the narrowing in one place means an unexpected segment
 * renders the 404 instead of silently falling through to the default locale — which would
 * otherwise serve `/fr/shop` as Albanian under a French URL and pollute the index.
 */
export function resolveLocale(value: string): Locale {
  if (!hasLocale(routing.locales, value)) notFound();
  return value;
}
