import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, Repeat } from 'lucide-react';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { countAdminSubscriptions, listAdminSubscriptions } from '@/features/subscriptions/queries';
import { SUBSCRIPTION_STATUSES, toSubscriptionStatus } from '@/features/subscriptions/types';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Subscriptions' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const LABELS: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
};

const TONES: Record<string, string> = {
  active: 'bg-success text-white',
  paused: 'bg-warning text-white',
  cancelled: 'bg-ink-600 text-white',
};

/**
 * docs/06 §12 — the subscription list, plus the cron health widget §12 asks for.
 *
 * Ordered by next run rather than by creation: this is a schedule, and what an operator wants
 * from it is "what is about to happen". A list sorted newest-first buries tomorrow's deliveries
 * under last month's sign-ups.
 *
 * Read-only in v1. docs/06 §12 also wants pause/cancel on the customer's behalf and an editable
 * `next_run_at`; those are support acting *as* a customer, and every one of them already exists
 * as a customer-facing action. Reaching for them from here needs an impersonation story the
 * audit log can express, which is not something to improvise (docs/14 §12).
 */
export default async function AdminSubscriptionsPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'subscriptions.view')) redirect('/admin');

  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = raw ? toSubscriptionStatus(raw) : undefined;

  const [rows, counts, health] = await Promise.all([
    listAdminSubscriptions(status),
    countAdminSubscriptions(),
    cronHealth(),
  ]);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-semibold text-carbon-900">Subscriptions</h1>
      <p className="mt-1 text-sm text-ink-600">
        Scheduled repeat orders. The renewal engine runs daily at 06:00 CET and pays on delivery,
        like every other order.
      </p>

      {/* docs/06 §12 — the cron health widget. */}
      <div
        className={cn(
          'mt-4 rounded-lg border p-3 text-sm',
          health.healthy ? 'border-line bg-surface text-ink-600' : 'border-warning bg-warning/10',
        )}
      >
        {health.healthy ? (
          <p>
            Last subscription email sent{' '}
            <time dateTime={health.lastSentAt ?? undefined} data-numeric>
              {health.lastSentAt ? formatAdminDateTime(health.lastSentAt).display : '—'}
            </time>
            .
          </p>
        ) : (
          <p className="flex items-start gap-2 text-ink-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {/*
              Not "the cron is down" — it might be, or there might simply be nothing due. The
              widget reports what is knowable and lets the operator decide, rather than crying
              wolf on a quiet week.
            */}
            No subscription email has been sent in the last two days. That is expected if nothing
            was due; if deliveries were scheduled, check the cron.
          </p>
        )}
        {health.failedSubscriptions > 0 && (
          <p className="mt-1 text-ink-900" data-numeric>
            {health.failedSubscriptions} subscription
            {health.failedSubscriptions === 1 ? '' : 's'} with failed runs.
          </p>
        )}
      </div>

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-1.5">
        {[undefined, ...SUBSCRIPTION_STATUSES].map((value) => {
          const active = value === status;
          return (
            <Link
              key={value ?? 'all'}
              href={value ? `/admin/subscriptions?status=${value}` : '/admin/subscriptions'}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
              )}
            >
              {value ? LABELS[value] : 'All'}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {value ? (counts[value] ?? 0) : (counts.all ?? 0)}
              </span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Repeat className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-carbon-900">No subscriptions in this view</p>
          <p className="mt-1.5 text-sm text-ink-600">
            They appear when a customer chooses &ldquo;subscribe and save&rdquo; at checkout.
          </p>
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Subscriptions"
        >
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Subscriptions, soonest delivery first</caption>
            <thead>
              <tr className="border-b border-line bg-carbon-50 text-left">
                {['Customer', 'Every', 'Next run', 'Items', 'Orders', 'Status'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const next = formatAdminDateTime(row.nextRunAt);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="block text-ink-900">{row.customerName || '—'}</span>
                      <span className="block text-xs text-ink-500">{row.customerEmail}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-600" data-numeric>
                      {row.frequencyDays} d
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                      <time dateTime={row.nextRunAt} title={next.utc} data-numeric>
                        {next.display}
                      </time>
                      {row.consecutiveFailures > 0 && (
                        <span className="ml-1.5 text-xs text-warning" data-numeric>
                          {row.consecutiveFailures} failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600" data-numeric>
                      {row.itemCount}
                    </td>
                    <td className="px-4 py-3 text-ink-600" data-numeric>
                      {row.orderCount}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
                          TONES[row.status] ?? 'bg-ink-600 text-white',
                        )}
                      >
                        {LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * docs/06 §12 — "last run time + failures", from `email_log` as §12 suggests.
 *
 * There is no cron run table, and adding one for a single widget would be a schema for a
 * dashboard. `email_log` already records every subscription email with a timestamp, which is a
 * proxy for "the engine ran and had something to do" — imperfect, and the copy above says so
 * rather than presenting a quiet week as an outage.
 */
async function cronHealth(): Promise<{
  healthy: boolean;
  lastSentAt: string | null;
  failedSubscriptions: number;
}> {
  const supabase = await createClient();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: lastEmail }, { count }] = await Promise.all([
    supabase
      .from('email_log')
      .select('created_at')
      .like('template', 'subscription_%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .gt('consecutive_failures', 0),
  ]);

  const lastSentAt = (lastEmail as { created_at: string } | null)?.created_at ?? null;

  return {
    healthy: lastSentAt !== null && lastSentAt > twoDaysAgo,
    lastSentAt,
    failedSubscriptions: count ?? 0,
  };
}
