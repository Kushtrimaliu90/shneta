import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';

/**
 * docs/18 §3.2 — `GET /api/v1/merchant/catalogue`: BioCode's published SKUs, as JSON.
 *
 * The same identifiers-only export the portal hands out as a spreadsheet (docs/16 §9.2): SKU, barcode
 * and the two names. No retail price and no BioCode stock, by owner decision — a merchant matches its
 * own codes against this and then creates offers with `POST /offers`.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'catalogue' });
}
