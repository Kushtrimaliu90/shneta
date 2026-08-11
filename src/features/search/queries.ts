import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS, type Locale, STATIC_REVALIDATE_SECONDS } from '@/lib/constants';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { normalizeQuery, type SearchRedirect } from '@/features/search/redirects';

/**
 * Reads that support the search results page (docs/02 §7 — reads live in `queries.ts`).
 *
 * Everything here is on the **public** client and cached under the `search` tag, so the admin console
 * purges it on save and a shopper never pays for a lookup that changes twice a month.
 *
 * The matching itself lives in `redirects.ts`, which is not server-only — it is pure string logic and
 * belongs where a unit test can reach it.
 */

/**
 * The whole redirect table, cached.
 *
 * Fetched wholesale and matched in TypeScript rather than queried per search. The table is tens of rows
 * and changes when an operator edits it; a `where` clause per search would be a database round trip on
 * every results page render for a lookup that is almost always a miss. Given this project spent 22.8M
 * external requests on exactly that kind of per-request read, the default is now "fetch the small table
 * once".
 */
const fetchRedirects = cache(async (): Promise<SearchRedirect[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('search_redirects')
    .select('query, match_type, destination_path')
    .eq('is_active', true)
    .order('query');

  if (error) {
    logger.error('search redirects failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    query: row.query,
    matchType: row.match_type === 'contains' ? 'contains' : 'exact',
    destinationPath: row.destination_path,
  }));
});

export const listSearchRedirects = cache(async (): Promise<SearchRedirect[]> => {
  return unstable_cache(() => fetchRedirects(), ['search-redirects'], {
    tags: [CACHE_TAGS.search],
    revalidate: ISR_REVALIDATE_SECONDS,
  })();
});

/**
 * Spelling correction against the catalogue's own vocabulary, or null when there is nothing to suggest.
 *
 * Only worth calling on the zero-result path, so it is not cached per query — that would fill the cache
 * with one entry per typo, and typos are by definition not repeated often enough to pay for it.
 */
export async function getDidYouMean(rawQuery: string): Promise<string | null> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 2) return null;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('search_did_you_mean', { p_query: query });

  if (error) {
    logger.error('search_did_you_mean failed', { cause: error.message });
    return null;
  }

  const suggestion = typeof data === 'string' ? data.trim() : '';
  return suggestion && suggestion !== normalizeQuery(query) ? suggestion : null;
}

/**
 * The rotating placeholder examples, per locale.
 *
 * Content rather than code, so "teach catalogue breadth" stays true as the catalogue changes — the
 * examples an operator picks in January are not the ones that make sense in June. Cached under the
 * `search` tag alongside the synonyms and redirects, so the console purges all three together.
 */
const fetchPlaceholders = cache(async (): Promise<{ sq: string[]; en: string[] }> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'search_placeholders')
    .maybeSingle();

  if (error) {
    logger.error('search placeholders failed', { cause: error.message });
    return { sq: [], en: [] };
  }

  const raw = ((data as { value: Record<string, unknown> } | null)?.value ?? {}) as Record<
    string,
    unknown
  >;
  const list = (key: string): string[] =>
    Array.isArray(raw[key])
      ? (raw[key] as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [];

  return { sq: list('sq'), en: list('en') };
});

export const getSearchPlaceholders = cache(async (locale: Locale): Promise<string[]> => {
  const all = await unstable_cache(() => fetchPlaceholders(), ['search-placeholders'], {
    tags: [CACHE_TAGS.search],
    /*
     * The long tier, because this is the navbar's only cached read and the navbar is in the shared
     * storefront layout — so whatever number sits here becomes the cache life of every page that renders
     * through it. With the announcement bar fixed, this was the next thing holding all 166 pages at an
     * hour when their tiers asked for a day.
     *
     * Nothing here depends on the clock: these are rotating search hints from a settings row, and the
     * admin purges `CACHE_TAGS.search` on save, so an edit is immediate regardless of the number.
     */
    revalidate: STATIC_REVALIDATE_SECONDS,
  })();

  return locale === 'en' ? all.en : all.sq;
});
