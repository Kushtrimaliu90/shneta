import { NextResponse, type NextRequest } from 'next/server';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';
import { runReferralCron } from '@/features/referrals/engine';

/**
 * docs/17 §3 — the referral cron, daily.
 *
 * Five passes, in this order and for a reason: expire what has run out, auto-approve what has earned
 * approval, post the month's points on the 1st, warn about what is ending, then send the event emails
 * anything above has just made due. Expiry first because an expired link must not be approved, must not
 * be paid and must not be emailed as though it were still running; the emails last so a link created and
 * approved in the same run is announced in the order it happened rather than backwards.
 *
 * **Idempotent by construction, like the subscription cron.** The posting pass is a *true-up* — it pays
 * the difference between what the earnings ledger says a referrer has earned and what their wallet has
 * already received — so invoking it twice on the same day pays nothing the second time. Nothing here
 * needs a lock or a run log; the guarantee is one layer down, in SQL, where a second caller cannot
 * bypass it.
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

  try {
    const summary = await runReferralCron(new Date());

    // Flattened for the log, because a nested `posted` object is not searchable in a log line.
    logger.info('Referral cron completed', {
      expired: summary.expired,
      autoApproved: summary.autoApproved,
      period: summary.posted?.period ?? null,
      referrersPaid: summary.posted?.referrers ?? 0,
      pointsPosted: summary.posted?.points ?? 0,
      summariesSent: summary.summariesSent,
      noticesSent: summary.noticesSent,
      eventEmailsSent: summary.eventEmailsSent,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    /*
     * A throw here means something outside the per-pass error handling broke — a database outage, most
     * likely. The 500 is what tells Vercel's cron monitor the run failed; each pass already logs and
     * counts its own failures rather than aborting the rest.
     */
    logger.error('Referral cron threw', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'FAILED' }, { status: 500 });
  }
}
