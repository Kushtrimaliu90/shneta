import type { NextRequest } from 'next/server';
import { runMerchantApi } from '@/features/merchants/api/handler';
import { proposalsCreateBodySchema } from '@/features/merchants/api/schemas';

/**
 * docs/18 §3.4 — products BioCode does not list yet.
 *
 *   GET   the merchant's proposal batches with a per-status row count, newest first.
 *   POST  up to 200 rows as one batch, which a reviewer decides as one queue item (docs/16 §9.1).
 *
 * The same caps as the portal apply — three open batches per merchant — and the same outcome: an
 * approved row becomes a **draft** product that nobody can buy until compliance publishes it. The API
 * cannot attach photographs; those go through the portal, where the bytes are uploaded from a browser
 * and keyed by filename. Said plainly in docs/18 §3.4 rather than left for a developer to discover.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return runMerchantApi(request, { action: 'proposals' });
}

export async function POST(request: NextRequest) {
  return runMerchantApi(request, { action: 'proposals.create', body: proposalsCreateBodySchema });
}
