import { localizePath } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';

/**
 * Query-redirect matching, as pure functions.
 *
 * Split out of `queries.ts` because that module is `server-only` and this logic is neither: it is
 * string comparison with precedence rules, it has no I/O, and the precedence is the part most likely to
 * be wrong in a way nobody notices. Keeping it importable is what lets `tests/unit/search-redirects`
 * cover it directly rather than through a page render.
 */

export interface SearchRedirect {
  query: string;
  matchType: 'exact' | 'contains';
  destinationPath: string;
}

/**
 * Normalisation that has to agree with `public.search_normalize`.
 *
 * Lower-cased, accent-folded, whitespace-collapsed. `NFD` then stripping the combining marks folds ë→e
 * and ç→c the same way `unaccent` does, which is what makes a rule saved as "kthimi" match a shopper who
 * typed it on a keyboard without diacritics — the normal case on a phone here.
 *
 * If this and the SQL ever disagree, the symptom is a rule that silently never fires and no error
 * anywhere explaining why. That is what the unit tests are guarding.
 */
export function normalizeQuery(value: string): string {
  return value
    .normalize('NFD')
    // `\p{Diacritic}` rather than a literal combining-mark range: the range is invisible in an editor,
    // and a stray edit to characters nobody can see is not a diff anyone reviews.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The page a query should answer with instead of a product list, or null.
 *
 * Exact beats contains, and among `contains` matches the longest pattern wins — so a rule for
 * "porosia ime" is not swallowed by a broader rule for "ime". Without that ordering the broadest row in
 * the table quietly captures every query containing a common short word.
 */
export function matchSearchRedirect(
  redirects: SearchRedirect[],
  rawQuery: string,
  locale: Locale,
): string | null {
  const q = normalizeQuery(rawQuery);
  if (!q) return null;

  const exact = redirects.find((r) => r.matchType === 'exact' && r.query === q);
  if (exact) return localizePath(exact.destinationPath, locale);

  const contains = redirects
    .filter((r) => r.matchType === 'contains' && q.includes(r.query))
    .sort((a, b) => b.query.length - a.query.length)[0];

  return contains ? localizePath(contains.destinationPath, locale) : null;
}
