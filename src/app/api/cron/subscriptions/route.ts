import { NextResponse, type NextRequest } from 'next/server';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';
import { runDueSubscriptions, sendDueNotices } from '@/features/subscriptions/engine';

/**
 * docs/07 §8.2 — the renewal engine, daily at 06:00 CET.
 *
 * Two passes: T−3 notices, then the due runs. Notices first, deliberately — a subscription due
 * *today* has already had its notice three days ago, and running the orders first would let a
 * long batch push the notice pass past its window.
 *
 * **Idempotent by construction.** Invoking this twice creates one order per cycle, because
 * `claim_due_subscription` advances the schedule in the same statement that finds the
 * subscription due (migration 18). Nothing in this file needs a lock, a flag or a run log; the
 * guarantee lives one layer down where it cannot be bypassed by a second caller.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

  const now = new Date();

  try {
    const noticesSent = await sendDueNotices(now);
    const summary = await runDueSubscriptions(now);
    const result = { ...summary, noticesSent };

    logger.info('Subscription cron completed', result);
    return NextResponse.json({ ok: true, summary: result });
  } catch (error) {
    /*
     * A throw here means something outside the per-subscription try/catch broke — a database
     * outage, most likely. The 500 is what tells Vercel's cron monitor that the run failed;
     * every subscription-level failure is already handled and counted inside the engine.
     */
    logger.error('Subscription cron threw', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: 'RUN_FAILED' }, { status: 500 });
  }
}
