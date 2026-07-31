import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * Translatable DB content is jsonb shaped `{ "sq": "…", "en": "…" }` (CLAUDE.md §3).
 * Anything read out of such a column goes through `pickLocale`.
 */
export type LocalizedField = Partial<Record<Locale, string>> | null | undefined;

/** docs/08 §1 — `field[locale] ?? field.sq ?? ''`. Never returns null. */
export function pickLocale(field: LocalizedField, locale: Locale): string {
  if (!field) return '';
  const preferred = field[locale];
  if (typeof preferred === 'string' && preferred.length > 0) return preferred;
  const fallback = field[DEFAULT_LOCALE];
  return typeof fallback === 'string' ? fallback : '';
}

/**
 * True when the requested locale is missing and the caller is therefore reading Albanian.
 * docs/05 §7 — long-form bodies show a subtle "available in Albanian" note when this is true.
 */
export function isLocaleFallback(field: LocalizedField, locale: Locale): boolean {
  if (locale === DEFAULT_LOCALE || !field) return false;
  const preferred = field[locale];
  const hasPreferred = typeof preferred === 'string' && preferred.length > 0;
  const fallback = field[DEFAULT_LOCALE];
  const hasFallback = typeof fallback === 'string' && fallback.length > 0;
  return !hasPreferred && hasFallback;
}

/**
 * Parses an unknown jsonb value into a `LocalizedField`, dropping unknown keys and
 * non-string values. Supabase types jsonb as `Json`, so every read needs this.
 */
export function asLocalizedField(value: unknown): LocalizedField {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const out: Partial<Record<Locale, string>> = {};
  if (typeof record.sq === 'string') out.sq = record.sq;
  if (typeof record.en === 'string') out.en = record.en;
  return out;
}

/** Convenience: read a jsonb value straight to a display string. */
export function pickLocaleFrom(value: unknown, locale: Locale): string {
  return pickLocale(asLocalizedField(value), locale);
}

/** docs/08 §1 — `sq` is unprefixed, `en` lives under `/en`. Used by the locale switcher. */
export function localizePath(path: string, locale: Locale): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const stripped = clean.replace(/^\/en(?=\/|$)/, '') || '/';
  return locale === DEFAULT_LOCALE ? stripped : `/en${stripped === '/' ? '' : stripped}`;
}
