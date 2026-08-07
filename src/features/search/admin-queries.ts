import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';

/**
 * Reads for `/admin/search` (docs/02 §7).
 *
 * The **server** client, not the public one: every row here is staff-only by policy, and going through
 * the caller's session is what makes that true rather than merely intended. `search_rules` has no select
 * policy at all for anonymous readers — placement is commercially sensitive once merchants pay for it —
 * so the public client would come back empty and it would look like there were no rules.
 */

export interface QueryReportRow {
  queryNorm: string;
  exampleQuery: string;
  searches: number;
  zeroResults: number;
  relaxedResults: number;
  clicks: number;
  clickRatePct: number | null;
  avgResults: number | null;
  lastSearchedAt: string;
}

export interface SynonymGroupRow {
  id: string;
  label: string;
  terms: string[];
  isActive: boolean;
  note: string | null;
}

export interface SearchRuleRow {
  id: string;
  action: 'pin' | 'boost' | 'bury' | 'hide';
  productId: string;
  productName: LocalizedField;
  productSlug: string;
  query: string | null;
  matchType: 'exact' | 'contains' | 'any';
  pinPosition: number | null;
  weight: number;
  isActive: boolean;
  note: string | null;
}

export interface SearchRedirectRow {
  id: string;
  query: string;
  matchType: 'exact' | 'contains';
  destinationPath: string;
  isActive: boolean;
  note: string | null;
}

/**
 * The query report, most-searched first.
 *
 * Two hundred rows is the cap and it is not arbitrary: past that, a report stops being something a person
 * reads and becomes something they scroll. The queries that matter are at the top and in the zero-result
 * list, and both are visible without paging.
 */
export async function listQueryReport(limit = 200): Promise<QueryReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('search_query_report')
    .select('*')
    .order('searches', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('search query report failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    queryNorm: String(row.query_norm ?? ''),
    exampleQuery: String(row.example_query ?? row.query_norm ?? ''),
    searches: Number(row.searches ?? 0),
    zeroResults: Number(row.zero_results ?? 0),
    relaxedResults: Number(row.relaxed_results ?? 0),
    clicks: Number(row.clicks ?? 0),
    clickRatePct: row.click_rate_pct == null ? null : Number(row.click_rate_pct),
    avgResults: row.avg_results == null ? null : Number(row.avg_results),
    lastSearchedAt: String(row.last_searched_at ?? ''),
  }));
}

export async function listSynonymGroups(): Promise<SynonymGroupRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('search_synonym_groups')
    .select('id, label, terms, is_active, note')
    .order('label');

  if (error) {
    logger.error('synonym groups failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    terms: row.terms ?? [],
    isActive: row.is_active,
    note: row.note,
  }));
}

export async function listSearchRules(): Promise<SearchRuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('search_rules')
    .select('id, action, product_id, query, match_type, pin_position, weight, is_active, note, products(name, slug)')
    .order('query', { nullsFirst: false })
    .order('action');

  if (error) {
    logger.error('search rules failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const product = row.products as { name?: unknown; slug?: string } | null;
    return {
      id: row.id,
      action: row.action as SearchRuleRow['action'],
      productId: row.product_id,
      productName: asLocalizedField(product?.name),
      productSlug: product?.slug ?? '',
      query: row.query,
      matchType: row.match_type as SearchRuleRow['matchType'],
      pinPosition: row.pin_position,
      weight: Number(row.weight ?? 0),
      isActive: row.is_active,
      note: row.note,
    };
  });
}

export async function listSearchRedirectRows(): Promise<SearchRedirectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('search_redirects')
    .select('id, query, match_type, destination_path, is_active, note')
    .order('query');

  if (error) {
    logger.error('search redirects (admin) failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    query: row.query,
    matchType: row.match_type as SearchRedirectRow['matchType'],
    destinationPath: row.destination_path,
    isActive: row.is_active,
    note: row.note,
  }));
}
