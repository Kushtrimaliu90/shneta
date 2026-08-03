import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEnv } from '@/lib/env.server';
import { logger } from '@/lib/logger';
import { isPayoutRunDay, periodToSettle } from '@/features/merchants/payout-period';

/**
 * docs/16 §8 — the fortnightly payout run.
 *
 * Runs daily at 04:15 UTC and **acts on the 1st and the 16th**, settling the fortnight that just
 * closed. Daily rather than twice-monthly because one schedule is easier to reason about than two, and
 * because the decision of whether today is a run day belongs in code that can be unit-tested on the
 * boundary rather than in a cron expression nobody can exercise.
 *
 * ── What it does and does not do ──
 *
 * It **builds** statements. It does not pay anybody: `build_all_merchant_payouts` writes `pending`
 * payout rows and balances the ledger, and a human makes the bank transfers and records the references
 * on `/admin/payouts`. Automating the transfer is not a thing to switch on before somebody has watched
 * the numbers by hand for a few cycles — the same reasoning as auto-routing (§6).
 *
 * Idempotent: building the same period twice settles nothing the second time, because the first build
 * posted the balancing ledger row. So a retried or duplicated invocation is a no-op rather than a
 * double payment, which is the property that makes it safe to run daily.
 *
 * Service-role by design — cron jobs are one of the six sanctioned uses (docs/02 §6).
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
    logger.error('Payout cron is not configured', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  }

  const now = new Date();

  /*
   * `?force=1` runs it on any day, for a cycle that was missed or is being caught up by hand. It still
   * settles `periodToSettle`, so a forced run cannot invent a period — the worst it can do is build a
   * statement a day or two early, and building is not paying.
   */
  const forced = request.nextUrl.searchParams.get('force') === '1';

  if (!forced && !isPayoutRunDay(now)) {
    return NextResponse.json({ ok: true, skipped: 'not_a_run_day', date: now.toISOString() });
  }

  const period = periodToSettle(now);
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('build_all_merchant_payouts', {
    p_period_start: period.start,
    p_period_end: period.end,
  });

  if (error) {
    logger.error('payout run failed', { period: `${period.start}..${period.end}`, cause: error.message });
    return NextResponse.json({ error: 'RUN_FAILED', period }, { status: 500 });
  }

  const result = (data ?? {}) as { payouts?: { merchant_id: string; net_cents: number }[] };
  const payouts = result.payouts ?? [];
  const totalCents = payouts.reduce((sum, entry) => sum + entry.net_cents, 0);

  logger.info('payout run complete', {
    period: `${period.start}..${period.end}`,
    count: payouts.length,
    totalCents,
  });

  return NextResponse.json({
    ok: true,
    period,
    built: payouts.length,
    totalCents,
  });
}
