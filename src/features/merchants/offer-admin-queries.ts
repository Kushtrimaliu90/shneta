import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import type { OfferStatus } from '@/features/merchants/queries';

/**
 * docs/16 §11 — the reads behind `/admin/merchants/offers`.
 *
 * The same view the portal reads (`v_merchant_offer_detail`), on a staff session. `security_invoker`
 * is what makes that work: RLS runs as the caller, so the merchant sees one merchant's offers and the
 * reviewer sees every merchant's, from one definition. Two queries would drift, and the number that
 * drifted would be `merchant_due_cents` — the one a merchant would notice on a statement.
 */

export interface ReviewOffer {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantSlug: string;
  merchantStatus: string;
  commissionPct: number;
  variantId: string;
  sku: string;
  merchantSku: string | null;
  variantName: LocalizedField;
  productSlug: string;
  productName: LocalizedField;
  productPublished: boolean;
  retailPriceCents: number;
  askingPriceCents: number;
  merchantDueCents: number;
  stockOnHand: number;
  handlingDays: number;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = `id, merchant_id, merchant_name, merchant_slug, merchant_status, commission_pct,
  variant_id, sku, merchant_sku, variant_name, product_slug, product_name, product_status,
  retail_price_cents, asking_price_cents, merchant_due_cents, stock_on_hand, handling_days,
  status, created_at, updated_at`;

interface Raw {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  merchant_status: string;
  commission_pct: number;
  variant_id: string;
  sku: string;
  merchant_sku: string | null;
  variant_name: unknown;
  product_slug: string;
  product_name: unknown;
  product_status: string;
  retail_price_cents: number;
  asking_price_cents: number;
  merchant_due_cents: number | null;
  stock_on_hand: number;
  handling_days: number;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

export async function listOffersForReview(status?: OfferStatus): Promise<ReviewOffer[]> {
  const supabase = await createClient();

  let query = supabase
    .from('v_merchant_offer_detail')
    .select(COLUMNS)
    // Oldest first: a review queue is a queue, and the offer waiting longest is the one to do next.
    .order('updated_at', { ascending: true });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listOffersForReview failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    merchantSlug: row.merchant_slug,
    merchantStatus: row.merchant_status,
    commissionPct: Number(row.commission_pct),
    variantId: row.variant_id,
    sku: row.sku,
    merchantSku: row.merchant_sku,
    variantName: asLocalizedField(row.variant_name),
    productSlug: row.product_slug,
    productName: asLocalizedField(row.product_name),
    productPublished: row.product_status === 'published',
    retailPriceCents: row.retail_price_cents,
    askingPriceCents: row.asking_price_cents,
    merchantDueCents: row.merchant_due_cents ?? 0,
    stockOnHand: row.stock_on_hand,
    handlingDays: row.handling_days,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function offerCountsForReview(): Promise<Record<OfferStatus, number>> {
  const supabase = await createClient();
  const counts: Record<OfferStatus, number> = {
    draft: 0,
    pending_review: 0,
    approved: 0,
    rejected: 0,
    paused: 0,
  };

  const { data, error } = await supabase.from('merchant_offers').select('status');
  if (error) {
    logger.error('offerCountsForReview failed', { cause: error.message });
    return counts;
  }

  for (const row of (data ?? []) as { status: OfferStatus }[]) counts[row.status] += 1;
  return counts;
}
