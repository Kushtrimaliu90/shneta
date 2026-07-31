import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';

/**
 * docs/10 §5 — nightly housekeeping, 03:30 UTC.
 *
 *   · abandon carts untouched for 14 days (docs/07 §3.4)
 *   · cancel card orders left unpaid for more than 24 h (docs/07 §6.2)
 *   · purge rate_limits buckets older than 2 days
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
  const summary = { cartsAbandoned: 0, ordersCancelled: 0, rateLimitsPurged: 0 };
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

  if (failures.length > 0) {
    logger.error('Housekeeping cron completed with failures', { summary, failures });
    return NextResponse.json({ ok: false, summary, failures }, { status: 500 });
  }

  logger.info('Housekeeping cron completed', summary);
  return NextResponse.json({ ok: true, summary });
}
