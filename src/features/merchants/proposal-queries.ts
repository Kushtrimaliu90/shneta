import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §4, §6 — proposals and the scorecard.
 *
 * RLS-scoped as everywhere else in the portal: a merchant reads its own proposals, staff read all of
 * them, and neither needs a `where merchant_id = ?` this module could forget.
 */

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'needs_info';

export interface Proposal {
  id: string;
  merchantId: string;
  merchantName: string | null;
  status: ProposalStatus;
  productName: string;
  brandName: string;
  form: string | null;
  variantName: string | null;
  barcode: string | null;
  sourceUrl: string | null;
  stockOnHand: number;
  askingPriceCents: number;
  note: string;
  reviewerNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Storage paths in the private `merchant-proposals` bucket, served through the signing route. */
  imagePaths: string[];
  /** Set once approval promoted this to a draft product (docs/16 §9). */
  createdProductId: string | null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

const STATUSES: readonly ProposalStatus[] = ['pending', 'approved', 'rejected', 'needs_info'];

function toStatus(value: unknown): ProposalStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as ProposalStatus)
    : 'pending';
}

interface Raw {
  id: string;
  merchant_id: string;
  status: string;
  payload: Record<string, unknown> | null;
  reviewer_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  created_product_id: string | null;
  merchants: { display_name: string } | null;
}

function toProposal(row: Raw): Proposal {
  const payload = row.payload ?? {};

  return {
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.display_name ?? null,
    status: toStatus(row.status),
    productName: asText(payload.product_name),
    brandName: asText(payload.brand_name),
    form: asNullableText(payload.form),
    variantName: asNullableText(payload.variant_name),
    barcode: asNullableText(payload.barcode),
    sourceUrl: asNullableText(payload.source_url),
    stockOnHand: asNumber(payload.stock_on_hand),
    askingPriceCents: asNumber(payload.asking_price_cents),
    note: asText(payload.note),
    reviewerNote: row.reviewer_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    imagePaths: Array.isArray(payload.images)
      ? (payload.images as unknown[]).filter((value): value is string => typeof value === 'string')
      : [],
    createdProductId: row.created_product_id,
  };
}

const COLUMNS = `id, merchant_id, status, payload, reviewer_note, created_at, reviewed_at,
  created_product_id, merchants ( display_name )`;

/**
 * Proposals submitted **on their own**, oldest first.
 *
 * Batch rows are excluded (`batch_id is null`) and read through `getBatch` instead (docs/16 §9.1). Both
 * screens this feeds — the merchant's list and the reviewer's queue — show one card per proposal, and 200
 * cards from one pasted catalogue would bury every individually-considered proposal underneath it. The
 * batch is its own queue item, with its own table.
 */
export async function listProposals(status?: ProposalStatus): Promise<Proposal[]> {
  const supabase = await createClient();

  let query = supabase
    .from('product_proposals')
    .select(COLUMNS)
    .is('batch_id', null)
    // Oldest first for a review queue; the merchant's own list is short enough that it does not matter.
    .order('created_at', { ascending: true });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listProposals failed', { cause: error.message });
    return [];
  }
  return ((data ?? []) as unknown as Raw[]).map(toProposal);
}

export async function proposalCounts(): Promise<Record<ProposalStatus, number>> {
  const counts: Record<ProposalStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    needs_info: 0,
  };

  const supabase = await createClient();
  // Standalone proposals only, matching `listProposals` — the batches are counted as batches.
  const { data, error } = await supabase
    .from('product_proposals')
    .select('status')
    .is('batch_id', null);

  if (error) {
    logger.error('proposalCounts failed', { cause: error.message });
    return counts;
  }

  for (const row of (data ?? []) as { status: string }[]) {
    counts[toStatus(row.status)] += 1;
  }
  return counts;
}

export interface Scorecard {
  assigned: number;
  accepted: number;
  declined: number;
  shipped: number;
  delivered: number;
  cancelledAfterAccept: number;
  lateDispatch: number;
  /**
   * `null` when there is no history to judge, not zero.
   *
   * A new merchant has not failed to accept anything, and a 0% acceptance rate on its first day would
   * put it bottom of every buy-box tie-break before it had a chance to earn anything.
   */
  acceptanceRate: number | null;
  cancellationRate: number | null;
  avgAcceptHours: number | null;
  avgDispatchHours: number | null;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The observed performance of one merchant.
 *
 * The function refuses a merchant asking about a rival, so this returns the zero card in that case
 * rather than surfacing an exception to a page — the caller has no useful branch for "you asked about
 * somebody else", because the UI never offers it.
 */
export async function merchantScorecard(merchantId: string): Promise<Scorecard> {
  const empty: Scorecard = {
    assigned: 0,
    accepted: 0,
    declined: 0,
    shipped: 0,
    delivered: 0,
    cancelledAfterAccept: 0,
    lateDispatch: 0,
    acceptanceRate: null,
    cancellationRate: null,
    avgAcceptHours: null,
    avgDispatchHours: null,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_scorecard', {
    p_merchant_id: merchantId,
  });

  if (error) {
    logger.error('merchantScorecard failed', { cause: error.message });
    return empty;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    assigned: asNumber(row.assigned),
    accepted: asNumber(row.accepted),
    declined: asNumber(row.declined),
    shipped: asNumber(row.shipped),
    delivered: asNumber(row.delivered),
    cancelledAfterAccept: asNumber(row.cancelled_after_accept),
    lateDispatch: asNumber(row.late_dispatch),
    acceptanceRate: asNullableNumber(row.acceptance_rate),
    cancellationRate: asNullableNumber(row.cancellation_rate),
    avgAcceptHours: asNullableNumber(row.avg_accept_hours),
    avgDispatchHours: asNullableNumber(row.avg_dispatch_hours),
  };
}

export interface CatalogueRow {
  sku: string;
  barcode: string;
  productName: string;
  variantName: string;
  priceCents: number;
  inStock: boolean;
}

/**
 * BioCode's published SKUs, for a merchant building a sheet of offers it does not have yet (§6.1).
 *
 * The counterpart to `offersExport`, and the reason bulk *creation* is usable at all: a merchant cannot
 * paste `sku;price;stock` for a catalogue whose codes it has never been told, and every guess lands in the
 * report as `unknown_sku`. `inStock` is the commercially interesting column — where BioCode is short is
 * exactly where a merchant's offer wins the buy box.
 */
export async function catalogueExport(): Promise<CatalogueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('catalogue_export');

  if (error) {
    logger.error('catalogueExport failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as {
      sku: string;
      barcode: string;
      product_name: string;
      variant_name: string;
      price_cents: number;
      in_stock: boolean;
    }[]
  ).map((row) => ({
    sku: row.sku,
    barcode: row.barcode,
    productName: row.product_name,
    variantName: row.variant_name,
    priceCents: row.price_cents,
    inStock: row.in_stock,
  }));
}

export interface OfferExportRow {
  sku: string;
  merchantSku: string;
  productName: string;
  variantName: string;
  status: string;
  stockOnHand: number;
  priceCents: number;
  retailPriceCents: number;
}

/** A merchant's offers as export rows, so the sheet it edits is one it was given. */
export async function offersExport(merchantId: string): Promise<OfferExportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_offers_export', {
    p_merchant_id: merchantId,
  });

  if (error) {
    logger.error('offersExport failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as {
      sku: string;
      merchant_sku: string;
      product_name: string;
      variant_name: string;
      status: string;
      stock_on_hand: number;
      price_cents: number;
      retail_price_cents: number;
    }[]
  ).map((row) => ({
    sku: row.sku,
    merchantSku: row.merchant_sku,
    productName: row.product_name,
    variantName: row.variant_name,
    status: row.status,
    stockOnHand: row.stock_on_hand,
    priceCents: row.price_cents,
    retailPriceCents: row.retail_price_cents,
  }));
}
