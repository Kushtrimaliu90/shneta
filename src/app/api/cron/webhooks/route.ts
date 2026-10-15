import { NextResponse, type NextRequest } from 'next/server';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';
import { drainWebhookQueue } from '@/features/merchants/webhooks/deliver';

/**
 * docs/18 §3.6 — delivers queued merchant webhooks, every five minutes.
 *
 * Service-role by design — cron jobs are one of the sanctioned uses (docs/02 §6). Idempotent in the
 * only way a delivery job can be: a row is claimed under `skip locked` with its next attempt already
 * scheduled, so a second run never sends the same row twice and a run that dies leaves rows that
 * simply come due again. Backoff and the auto-disable live in `record_webhook_delivery`.
 *
 * Two batches a run at most: fifty rows with eight in flight is well inside the budget, and a queue
 * deeper than a hundred means an endpoint is down, which the backoff already spreads out.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = requireEnv('CRON_SECRET', 'cron routes');
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
  } catch (error) {
    logger.error('Cron route is not configured', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  }

  const summary = { claimed: 0, delivered: 0, failed: 0 };

  for (let round = 0; round < 2; round += 1) {
    const batch = await drainWebhookQueue(50);
    summary.claimed += batch.claimed;
    summary.delivered += batch.delivered;
    summary.failed += batch.failed;
    if (batch.claimed < 50) break;
  }

  logger.info('webhook cron complete', summary);
  return NextResponse.json({ ok: true, ...summary });
}
