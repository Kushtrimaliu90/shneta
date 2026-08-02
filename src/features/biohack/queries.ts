import 'server-only';
import { unstable_cache } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import { createAdminClient } from '@/lib/supabase/admin';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { mapProductRow } from '@/features/catalog/queries';
import type { ProductListItem } from '@/features/catalog/types';
import type { LocalizedField } from '@/lib/i18n';
import type { ProtocolResult } from '@/features/biohack/types';

/**
 * docs/15 §1 — the reads behind the three steps and the result page.
 *
 * The engine's own inputs are loaded by `config-loader`; this is everything the *pages* need:
 * the goal tiles, the product cards a stored protocol refers to, and the stored protocol itself.
 */

export interface ProtocolGoal {
  slug: string;
  name: LocalizedField;
  icon: string | null;
}

/**
 * The 16 tiles in step 1, in taxonomy order.
 *
 * Read from `health_goals` rather than derived from the config's blocks: a goal with no blocks
 * yet should still be visible and simply produce a thin protocol, and — more to the point — the
 * config is not readable by anon, so deriving the list from it would leak what compliance has
 * approved into a page that anyone can view.
 */
const readGoals = async (): Promise<ProtocolGoal[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('health_goals')
    .select('slug, name, icon')
    .eq('is_active', true)
    .order('sort_order');

  if (error) {
    logger.error('biohack goals read failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    slug: row.slug,
    name: row.name as LocalizedField,
    icon: row.icon,
  }));
};

export const getProtocolGoals = unstable_cache(readGoals, ['biohack-goals'], {
  tags: [CACHE_TAGS.goals],
  revalidate: ISR_REVALIDATE_SECONDS,
});

/**
 * Product cards for the ids a stored protocol names.
 *
 * Through `search_products`, the same RPC the shop listing uses, so a card in a protocol carries
 * exactly what a card anywhere else does — image, rating, price, stock badge. Fetching the whole
 * published set and filtering in memory is one round trip for up to five ids scattered across the
 * catalogue; the alternative is a query per id or a hand-rolled join that would drift from the
 * listing's own mapping.
 */
export async function getProtocolProducts(productIds: string[]): Promise<ProductListItem[]> {
  if (productIds.length === 0) return [];

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('search_products', {
    p_sort: 'rating',
    p_limit: 250,
    p_offset: 0,
  });

  if (error) {
    logger.error('biohack product cards failed', { cause: error.message });
    return [];
  }

  const wanted = new Set(productIds);
  return ((data ?? []) as unknown as Record<string, unknown>[])
    .map(mapProductRow)
    .filter((product) => wanted.has(product.id));
}

export interface StoredProtocol {
  shareCode: string;
  configVersion: number;
  result: ProtocolResult;
  /** True when the row belongs to the signed-in reader — the difference "Ruaje" acts on. */
  isOwn: boolean;
  /** True when the row has no owner yet, so the reader can claim it. */
  claimable: boolean;
}

/**
 * One stored protocol, by share code.
 *
 * **Service client, listed in docs/02 §6.** `generated_protocols` is own-rows-only under RLS,
 * which means a guest — who has no session and therefore no rows — could never read back the
 * protocol they just generated. `get_shared_protocol` exists for the read-only share page and
 * deliberately returns the result and nothing else; the owner's page also needs to know whether
 * the row is claimable, so it reads the row itself, server-side, and returns only what the page
 * renders.
 *
 * The share code is the capability. Nothing else in the row identifies a person: `inputs` never
 * leaves this function, and `user_id` leaves it only as the two booleans above.
 */
export async function getStoredProtocol(
  code: string,
  viewerId: string | null,
): Promise<StoredProtocol | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('generated_protocols')
    .select('share_code, config_version, result, user_id')
    .eq('share_code', code)
    .maybeSingle();

  if (error) {
    logger.error('stored protocol read failed', { cause: error.message });
    return null;
  }
  if (!data) return null;

  const result = asProtocolResult(data.result);
  if (!result) {
    logger.error('stored protocol has an unreadable result', { code });
    return null;
  }

  return {
    shareCode: data.share_code,
    configVersion: data.config_version,
    result,
    isOwn: viewerId !== null && data.user_id === viewerId,
    claimable: data.user_id === null,
  };
}

/**
 * Narrows the stored jsonb back to a result.
 *
 * The column is `jsonb`, so the type system knows nothing about what came out — and this row may
 * have been written by an older deploy whose `ProtocolResult` had fewer fields. Checking the
 * handful the page actually indexes into is enough to keep a stale row from throwing; anything
 * missing beyond that renders as an empty section rather than a crash.
 */
function asProtocolResult(value: unknown): ProtocolResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<ProtocolResult>;
  if (!Array.isArray(candidate.items)) return null;
  if (typeof candidate.configVersion !== 'number') return null;

  return {
    ...(candidate as ProtocolResult),
    alternates: Array.isArray(candidate.alternates) ? candidate.alternates : [],
    trace: Array.isArray(candidate.trace) ? candidate.trace : [],
    metrics: candidate.metrics ?? { sq: [], en: [] },
    goalSlugs: Array.isArray(candidate.goalSlugs) ? candidate.goalSlugs : [],
  };
}
