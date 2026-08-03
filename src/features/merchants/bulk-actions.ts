'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getMyMerchant } from '@/features/merchants/queries';
import { parseOfferCsv, type CsvRow } from '@/features/merchants/csv';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §6 — a merchant updating stock and price in bulk.
 *
 * ── Pasted text, not an uploaded file ──
 *
 * The form takes a textarea. A file input would need a client-side reader and a multipart body, and a
 * merchant's actual workflow is "open the spreadsheet, select the columns, copy" — which lands in a
 * textarea with no upload at all. It also keeps the payload inside a server action's body limit, unlike
 * the KYB documents where the file genuinely is the point.
 *
 * ── The report is the feature ──
 *
 * A hundred-row paste where four rows are wrong must say which four and why. `merchant_bulk_update_offers`
 * applies what it can in one transaction and returns the skips with reasons, so a merchant fixes four
 * lines rather than re-uploading everything and hoping.
 */

export type BulkErrorKey =
  | 'merchant.bulk.errors.generic'
  | 'merchant.bulk.errors.notMerchant'
  | 'merchant.bulk.errors.empty'
  | 'merchant.bulk.errors.tooMany'
  | 'merchant.bulk.errors.noHeader';

export interface BulkReport {
  applied: number;
  skipped: { sku: string; reason: string }[];
  /** Rows the CSV parser itself rejected, before the database saw them. */
  malformed: { line: number; reason: string }[];
}

export type BulkState = ActionResult<BulkReport, BulkErrorKey> | null;

function no(error: BulkErrorKey): BulkState {
  return fail<BulkErrorKey, BulkReport>(error);
}

export async function bulkUpdateOffers(
  _previous: BulkState,
  formData: FormData,
): Promise<BulkState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') return no('merchant.bulk.errors.notMerchant');

  const text = String(formData.get('csv') ?? '');
  if (text.trim().length === 0) return no('merchant.bulk.errors.empty');

  const parsed = parseOfferCsv(text);
  if (parsed.kind === 'no_header') return no('merchant.bulk.errors.noHeader');
  if (parsed.rows.length === 0 && parsed.malformed.length === 0) return no('merchant.bulk.errors.empty');
  if (parsed.rows.length > 2000) return no('merchant.bulk.errors.tooMany');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('merchant_bulk_update_offers', {
      p_merchant_id: merchant.id,
      p_rows: parsed.rows as unknown as Json,
    });

    if (error) {
      if (error.message.includes('TOO_MANY_ROWS')) return no('merchant.bulk.errors.tooMany');
      logger.error('bulkUpdateOffers failed', { cause: error.message });
      return no('merchant.bulk.errors.generic');
    }

    const result = (data ?? {}) as {
      applied?: number;
      skipped?: { sku: string; reason: string }[];
    };

    revalidatePath('/merchant/offers');
    revalidatePath('/merchant');

    return ok({
      applied: result.applied ?? 0,
      skipped: result.skipped ?? [],
      malformed: parsed.malformed,
    });
  } catch (error) {
    logger.error('bulkUpdateOffers threw', describeError(error));
    return no('merchant.bulk.errors.generic');
  }
}

/** Re-exported for the page that renders the parser's own preview before submitting. */
export type { CsvRow };
