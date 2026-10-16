import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';

/**
 * docs/18 §3.1 — `GET /api/v1/merchant/me`: who this key belongs to.
 *
 * The first call every integration makes, and the one a developer uses to check a key is live. It
 * returns the merchant's name and the key's own name and prefix — nothing a merchant does not already
 * see on the portal.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'me' });
}
