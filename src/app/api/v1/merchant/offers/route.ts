import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { offersUpsertBodySchema } from '@/features/merchants/api/schemas';

/**
 * docs/18 §3.3 — the merchant's offers.
 *
 *   GET   the merchant's own offers, every status, newest change first.
 *   POST  stock, price, dispatch days and low-stock level for up to 2000 SKUs in one call, and with
 *         `create: true` new draft offers for SKUs the merchant has none on.
 *
 * `POST` rather than `PATCH` because the call is a batch with a per-row report, not a resource
 * update: it applies what it can and returns `skipped` with a reason per row, exactly as the portal's
 * paste does (`merchant_bulk_upsert_offers`). A price change on a live offer sends it back to review
 * and takes it off the shelf until a reviewer looks (docs/16 §6, migration 80) — that is the same
 * rule the portal applies, and the response does not hide it: the offer's `status` on the next GET is
 * `pending_review`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'offers' });
}

export async function POST(request: NextRequest) {
  return runMerchantApi(request, { action: 'offers.upsert', body: offersUpsertBodySchema });
}
