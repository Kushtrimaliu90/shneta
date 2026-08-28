import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { cn } from '@/lib/utils';
import {
  fulfilmentCandidates,
  fulfilmentLines,
  routingQueue,
} from '@/features/merchants/routing-queries';
import { RoutingCard } from '@/features/merchants/components/routing-card';

export const metadata: Metadata = { title: 'Routing' };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/16 §6 — the daily-driver screen.
 *
 * Oldest first, because a routing queue is a queue and the waiting time is the SLA the marketplace
 * terms promise (24 hours to accept). A queue sorted by anything else hides the item that is late.
 *
 * `routing.manage` is support and warehouse, not admin-only: this is operational work, unlike setting a
 * commission. The capability is checked here **and** inside every function the page calls — the SQL
 * check is the boundary and holds for a future cron; this one exists so a wrong turn gets a redirect
 * instead of an exception.
 *
 * Candidates and lines are fetched per fulfilment, in parallel. Sequentially it would be two round
 * trips per row, which on a queue of twenty is forty waits for a screen somebody refreshes all day.
 */
export default async function AdminRoutingPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'routing.manage')) redirect('/admin');

  const params = await searchParams;
  const showAssigned = (Array.isArray(params.view) ? params.view[0] : params.view) === 'assigned';

  const queue = await routingQueue(showAssigned);
  const visible = showAssigned ? queue.filter((row) => row.status === 'assigned') : queue;

  const enriched = await Promise.all(
    visible.map(async (row) => ({
      row,
      lines: await fulfilmentLines(row.fulfilmentId),
      candidates: await fulfilmentCandidates(row.fulfilmentId),
    })),
  );

  const waiting = queue.filter((row) => row.status === 'unassigned').length;
  const late = queue.filter((row) => row.status === 'unassigned' && row.waitingHours >= 24).length;

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Routing</h1>
        <p className="mt-1 text-sm text-ink-600">
          Merchant-sourced fulfilments waiting for a decision. The buy box already proposed a
          merchant and reserved its stock at checkout; confirming changes nothing, re-routing moves
          the reservation and recomputes the commission.
        </p>
      </header>

      {late > 0 && (
        <p className="rounded-md border border-error/40 bg-error/5 p-4 text-sm text-ink-900">
          {late} of {waiting} have been waiting more than 24 hours — the acceptance window the
          marketplace terms promise.
        </p>
      )}

      <nav aria-label="Filter the queue" className="flex flex-wrap gap-1.5">
        <Tab
          href="/admin/routing"
          active={!showAssigned}
          label="Awaiting routing"
          count={waiting}
        />
        <Tab
          href="/admin/routing?view=assigned"
          active={showAssigned}
          label="Assigned, not yet accepted"
          count={queue.filter((row) => row.status === 'assigned').length}
        />
      </nav>

      {enriched.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-ink-600">
          {showAssigned
            ? 'Nothing assigned and waiting. Merchants accept from their portal.'
            : 'Nothing to route. Merchant-sourced orders arrive here automatically.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {enriched.map(({ row, lines, candidates }) => (
            <li key={row.fulfilmentId}>
              <RoutingCard row={row} lines={lines} candidates={candidates} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors',
        active
          ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
          : 'border-line-strong text-ink-600 hover:bg-forest-50',
      )}
    >
      {label}
      <span className="font-ui font-semibold" data-numeric>
        {count}
      </span>
    </Link>
  );
}
