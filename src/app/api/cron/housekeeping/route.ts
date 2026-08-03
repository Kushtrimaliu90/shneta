import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';
import { findReviewRequestTargets, sendReviewRequest } from '@/features/reviews/email';

/**
 * docs/10 §5 — nightly housekeeping, 03:30 UTC.
 *
 *   · abandon carts untouched for 14 days (docs/07 §3.4)
 *   · cancel card orders left unpaid for more than 24 h (docs/07 §6.2)
 *   · purge rate_limits buckets older than 2 days
 *   · ask for a review seven days after delivery (docs/12 M7)
 *   · recompute merchant ratings, the buy-box tie-break (docs/16 §6)
 *
 * Service-role by design — cron jobs are one of the six sanctioned uses (docs/02 §6).
 * Idempotent: every step is bounded by a timestamp predicate, so re-running it the same
 * night is a no-op rather than a double effect.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the var is set.
  const secret = requireEnv('CRON_SECRET', 'cron routes');
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
  } catch (error) {
    // A missing CRON_SECRET is a misconfiguration, not an auth failure — say so, and
    // never let an unguarded cron endpoint run.
    logger.error('Cron route is not configured', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  }

  const supabase = createAdminClient();
  const summary = {
    cartsAbandoned: 0,
    ordersCancelled: 0,
    rateLimitsPurged: 0,
    reviewRequestsSent: 0,
    ratingsChanged: 0,
  };
  const failures: string[] = [];

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // 1 · Abandon stale carts. Data for future win-back emails; no email in v1.
  {
    const { data, error } = await supabase
      .from('carts')
      .update({ status: 'abandoned' })
      .eq('status', 'active')
      .lt('updated_at', fourteenDaysAgo)
      .select('id');
    if (error) failures.push(`carts: ${error.message}`);
    else summary.cartsAbandoned = data?.length ?? 0;
  }

  /*
   * 2 · Cancel unpaid card orders. Scoped to `bank_pos` with a still-pending payment:
   * COD orders are *meant* to sit pending until the courier delivers, so cancelling on
   * age alone would wipe the entire live order book.
   */
  {
    const { data: stale, error } = await supabase
      .from('payments')
      .select('order_id')
      .eq('provider', 'bank_pos')
      .eq('status', 'pending')
      .lt('created_at', dayAgo);

    if (error) {
      failures.push(`payments: ${error.message}`);
    } else {
      for (const row of stale ?? []) {
        // One at a time so the state-machine trigger validates each transition and the
        // restock side effect fires per order.
        const { error: cancelError } = await supabase
          .from('orders')
          .update({ status: 'cancelled' })
          .eq('id', row.order_id)
          .eq('status', 'pending');
        if (cancelError) failures.push(`order ${row.order_id}: ${cancelError.message}`);
        else summary.ordersCancelled += 1;
      }
    }
  }

  // 3 · Purge spent rate-limit buckets.
  {
    const { data, error } = await supabase
      .from('rate_limits')
      .delete()
      .lt('window_start', twoDaysAgo)
      .select('key');
    if (error) failures.push(`rate_limits: ${error.message}`);
    else summary.rateLimitsPurged = data?.length ?? 0;
  }

  /*
   * 4 · Ask for a review, seven days after delivery (docs/12 M7).
   *
   * Sequential rather than `Promise.all`: a hundred concurrent sends would hit the provider's
   * rate limit and fail as a batch, and nothing here is time-critical enough to be worth that.
   * `sendReviewRequest` swallows its own failures, so one bad address cannot end the run.
   */
  {
    const targets = await findReviewRequestTargets(new Date());
    for (const target of targets) {
      await sendReviewRequest(target);
      summary.reviewRequestsSent += 1;
    }
  }

  /*
   * 5 · Recompute merchant ratings (docs/16 §6).
   *
   * `merchants.rating_avg` is the buy-box tie-break, read on every product page and recomputed from a
   * ninety-day window of fulfilment history. A nightly job rather than a trigger on every fulfilment
   * update: the inputs move a handful of times a day and the value is read hundreds, so it is cached —
   * and a job that fails is visible here, where a trigger that made every shipment write slower would
   * not be.
   *
   * Its own block with its own failure entry, so a rating recalculation that breaks does not stop the
   * cart-abandonment sweep above it from having happened.
   */
  {
    const { data, error } = await supabase.rpc('recompute_all_merchant_ratings');
    if (error) failures.push(`ratings: ${error.message}`);
    else {
      const result = (data ?? {}) as { changed?: unknown[] };
      summary.ratingsChanged = result.changed?.length ?? 0;
    }
  }

  if (failures.length > 0) {
    logger.error('Housekeeping cron completed with failures', { summary, failures });
    return NextResponse.json({ ok: false, summary, failures }, { status: 500 });
  }

  logger.info('Housekeeping cron completed', summary);
  return NextResponse.json({ ok: true, summary });
}
