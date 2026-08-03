import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import type { StockStatus, VariantSupply } from '@/features/catalog/types';

export type { VariantSupply };

/**
 * docs/16 §1 — who supplies a variant, read from the one function that decides it.
 *
 * BioCode stock always wins; otherwise the cheapest approved, in-stock offer from an approved
 * merchant. The rule lives in `variant_buy_box` and nothing here re-implements it, because a second
 * copy of "who is selling this" is how the PDP and the routing screen come to disagree.
 *
 * ── What this is not ──
 *
 * It is not a price. The canonical variant price is the only customer-facing price, whoever holds
 * the stock; a merchant offer is *supply*, and its `price_cents` is what the merchant asks BioCode.
 * The function does not return it and this module could not expose it if it wanted to.
 */

interface BuyBoxRow {
  variant_id: string;
  source: string | null;
  stock_status: string | null;
  merchant_id: string | null;
  merchant_slug: string | null;
  merchant_name: string | null;
  offer_id: string | null;
  handling_days: number | null;
  supplier_count: number | null;
}

const SOURCES = new Set(['biocode', 'merchant', 'none']);
const STATUSES = new Set(['in_stock', 'low', 'out_of_stock']);

/**
 * Supply for a set of variants, keyed by variant id.
 *
 * Returns an **empty map on failure rather than throwing**, and every caller treats a missing entry
 * as "BioCode, as before". A marketplace lookup that fails must not take the product page down with
 * it: the page's own stock line is read separately and is still correct.
 */
export async function variantSupply(variantIds: string[]): Promise<Map<string, VariantSupply>> {
  const result = new Map<string, VariantSupply>();
  if (variantIds.length === 0) return result;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc('variant_buy_box', { p_variant_ids: variantIds });

  if (error) {
    logger.error('variantSupply failed', { count: variantIds.length, cause: error.message });
    return result;
  }

  for (const row of (data ?? []) as BuyBoxRow[]) {
    const source = row.source && SOURCES.has(row.source) ? row.source : 'none';
    const status = row.stock_status && STATUSES.has(row.stock_status) ? row.stock_status : 'out_of_stock';

    result.set(row.variant_id, {
      variantId: row.variant_id,
      source: source as VariantSupply['source'],
      stockStatus: status as StockStatus,
      merchantId: row.merchant_id,
      merchantSlug: row.merchant_slug,
      merchantName: row.merchant_name,
      offerId: row.offer_id,
      handlingDays: row.handling_days,
      supplierCount: row.supplier_count ?? 0,
    });
  }

  return result;
}
