import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §9.1 — reading proposal batches, for the merchant that sent one and the reviewer deciding it.
 *
 * Both sides read through the **user-context client**, so one definition serves both and RLS decides what
 * each sees: a merchant its own batches (`p_own_read`), staff every batch (`p_staff_read`). The same shape
 * as `v_merchant_offer_detail` in §5, and for the same reason — two queries that differ only in which rows
 * they are allowed to return will eventually differ in more than that.
 */

export interface BatchRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  productName: string;
  brandName: string;
  form: string | null;
  variantName: string | null;
  barcode: string | null;
  merchantSku: string | null;
  sourceUrl: string | null;
  stockOnHand: number;
  askingPriceCents: number;
  note: string | null;
  reviewerNote: string | null;
  imagePaths: string[];
  createdProductId: string | null;
}

export interface Batch {
  id: string;
  merchantId: string;
  merchantName: string | null;
  status: 'pending' | 'decided';
  note: string | null;
  rowCount: number;
  reviewerNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface BatchWithRows extends Batch {
  rows: BatchRow[];
}

interface RawBatch {
  id: string;
  merchant_id: string;
  status: string;
  note: string | null;
  row_count: number;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  merchants: { display_name: string } | null;
}

function toBatch(raw: RawBatch): Batch {
  return {
    id: raw.id,
    merchantId: raw.merchant_id,
    merchantName: raw.merchants?.display_name ?? null,
    status: raw.status === 'decided' ? 'decided' : 'pending',
    note: raw.note,
    rowCount: raw.row_count,
    reviewerNote: raw.reviewer_note,
    reviewedAt: raw.reviewed_at,
    createdAt: raw.created_at,
  };
}

const BATCH_COLUMNS =
  'id, merchant_id, status, note, row_count, reviewer_note, reviewed_at, created_at, merchants ( display_name )';

/** Every batch this session may see, newest first. RLS decides whether that is one merchant's or all. */
export async function listBatches(options?: { onlyPending?: boolean }): Promise<Batch[]> {
  const supabase = await createClient();
  let query = supabase
    .from('proposal_batches')
    .select(BATCH_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);

  if (options?.onlyPending) query = query.eq('status', 'pending');

  const { data, error } = await query;

  if (error) {
    logger.error('listBatches failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawBatch[]).map(toBatch);
}

/**
 * One batch with its rows.
 *
 * Two queries rather than one nested select: the rows carry a jsonb payload that has to be unpacked field
 * by field anyway, and PostgREST's nested-select types do not survive inference through the join. Returning
 * null for a batch RLS hides is what makes `notFound()` correct on both the merchant and the admin page.
 */
export async function getBatch(batchId: string): Promise<BatchWithRows | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('proposal_batches')
    .select(BATCH_COLUMNS)
    .eq('id', batchId)
    .maybeSingle();

  if (error) {
    logger.error('getBatch failed', { cause: error.message });
    return null;
  }
  if (!data) return null;

  const { data: rowData, error: rowError } = await supabase
    .from('product_proposals')
    .select('id, status, reviewer_note, created_product_id, payload')
    .eq('batch_id', batchId)
    .order('created_at');

  if (rowError) {
    logger.error('getBatch rows failed', { cause: rowError.message });
    return null;
  }

  const rows = ((rowData ?? []) as {
    id: string;
    status: string;
    reviewer_note: string | null;
    created_product_id: string | null;
    payload: Record<string, unknown> | null;
  }[]).map((row): BatchRow => {
    const payload = row.payload ?? {};
    const text = (key: string): string | null =>
      typeof payload[key] === 'string' && payload[key] !== '' ? (payload[key] as string) : null;

    return {
      id: row.id,
      status: (['pending', 'approved', 'rejected', 'needs_info'] as const).includes(
        row.status as BatchRow['status'],
      )
        ? (row.status as BatchRow['status'])
        : 'pending',
      productName: text('product_name') ?? '—',
      brandName: text('brand_name') ?? '—',
      form: text('form'),
      variantName: text('variant_name'),
      barcode: text('barcode'),
      merchantSku: text('merchant_sku'),
      sourceUrl: text('source_url'),
      stockOnHand: typeof payload.stock_on_hand === 'number' ? payload.stock_on_hand : 0,
      askingPriceCents:
        typeof payload.asking_price_cents === 'number' ? payload.asking_price_cents : 0,
      note: text('note'),
      reviewerNote: row.reviewer_note,
      imagePaths: Array.isArray(payload.images)
        ? (payload.images as unknown[]).filter((value): value is string => typeof value === 'string')
        : [],
      createdProductId: row.created_product_id,
    };
  });

  return { ...toBatch(data as unknown as RawBatch), rows };
}

/**
 * How many approved rows are still waiting for their draft product.
 *
 * Shown to the reviewer after approving a batch, because "60 approved" and "60 products exist" are
 * different facts and the gap between them is a cron run. Reading the view rather than counting rows keeps
 * the definition of "waiting" in one place (docs/16 §9.1).
 */
export async function countAwaitingPromotion(batchId?: string): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from('proposals_awaiting_promotion')
    .select('id', { count: 'exact', head: true });

  if (batchId) query = query.eq('batch_id', batchId);

  const { count, error } = await query;
  if (error) {
    logger.error('countAwaitingPromotion failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}
