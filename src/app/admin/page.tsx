import Link from 'next/link';
import type { Metadata } from 'next';
import { AlertTriangle, Clock } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime, ORDER_STATUS_LABELS } from '@/features/admin/copy';
import { getDashboardData, type KpiWindow } from '@/features/admin/dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * docs/06 §1 — the dashboard.
 *
 * Cards are filtered by capability, not just by role name: a warehouse manager gets the
 * confirmation queue and low stock, and no revenue. The same `can()` the sidebar uses, so what
 * is visible here and what is reachable there cannot disagree.
 *
 * **No chart library.** docs/06 §1 suggests recharts; this renders the 30-day series as a CSS
 * bar chart instead. Recharts is ~90 kB gzipped and would have to be a client component, on a
 * page whose entire job is to be glanced at — against a 170 kB route budget (docs/09 §3) that is
 * most of the allowance for something a `<div>` with a height does. It stays a Server Component
 * with no JavaScript at all, and the data is in a `<table>` underneath for screen readers, which
 * a canvas-based chart would not have given for free.
 */
export default async function AdminDashboardPage() {
  const profile = await getProfile();
  const data = await getDashboardData();

  const showRevenue = can(profile?.role, 'orders.refund') || can(profile?.role, 'settings.manage');
  const showOrders = can(profile?.role, 'orders.view');
  const showStock = can(profile?.role, 'inventory.manage');

  const peak = Math.max(...data.daily.map((point) => point.revenueCents), 1);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Dashboard</h1>
      <p className="mt-1 text-sm text-ink-600">Last 30 days · times shown in Europe/Belgrade</p>

      {/* ── KPIs ─────────────────────────────────────────────────────────────── */}
      {showOrders && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Kpi label="Today" window={data.today} showRevenue={showRevenue} />
          <Kpi label="Last 7 days" window={data.last7} showRevenue={showRevenue} />
          <Kpi label="Last 30 days" window={data.last30} showRevenue={showRevenue} />
        </div>
      )}

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_1fr]">
        <div className="flex min-w-0 flex-col gap-8">
          {/* ── Revenue by day ─────────────────────────────────────────────── */}
          {showRevenue && (
            <section aria-labelledby="revenue-heading">
              <h2
                id="revenue-heading"
                className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
              >
                Revenue by day
              </h2>

              {data.last30.orders === 0 ? (
                <p className="mt-3 text-sm text-ink-600">No orders in the last 30 days.</p>
              ) : (
                <>
                  <div
                    className="mt-3 flex h-32 items-end gap-0.5 rounded-lg border border-line bg-surface p-3"
                    aria-hidden="true"
                  >
                    {data.daily.map((point) => (
                      <div
                        key={point.day}
                        title={`${point.day}: ${formatPrice(point.revenueCents, 'en')}`}
                        className="min-w-0 flex-1 rounded-t-[2px] bg-forest-500"
                        /*
                         * An inline height is the one place a computed value has to reach the DOM
                         * directly — Tailwind cannot express "this row's share of the peak", and
                         * a class per percentage would be 100 classes the JIT never sees.
                         * `min-height` keeps a non-zero day visible rather than invisible.
                         */
                        style={{
                          height: `${Math.max((point.revenueCents / peak) * 100, point.revenueCents > 0 ? 4 : 0)}%`,
                        }}
                      />
                    ))}
                  </div>

                  {/*
                    The same series as a table, for anyone the bars are useless to. Collapsed by
                    default because thirty rows would dominate the page, but present in the DOM
                    and reachable by keyboard — which is more than a canvas chart offers.
                  */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-ink-600">
                      Show the figures as a table
                    </summary>
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-line">
                      <table className="w-full border-collapse text-sm">
                        <caption className="sr-only">Revenue and order count per day</caption>
                        <thead>
                          <tr className="border-b border-line bg-forest-50 text-left">
                            <th
                              scope="col"
                              className="px-3 py-2 text-xs font-semibold text-ink-600"
                            >
                              Day
                            </th>
                            <th
                              scope="col"
                              className="px-3 py-2 text-right text-xs font-semibold text-ink-600"
                            >
                              Orders
                            </th>
                            <th
                              scope="col"
                              className="px-3 py-2 text-right text-xs font-semibold text-ink-600"
                            >
                              Revenue
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...data.daily].reverse().map((point) => (
                            <tr key={point.day} className="border-b border-line last:border-0">
                              <td className="px-3 py-1.5" data-numeric>
                                {point.day}
                              </td>
                              <td className="px-3 py-1.5 text-right" data-numeric>
                                {point.orders}
                              </td>
                              <td className="px-3 py-1.5 text-right" data-numeric>
                                {formatPrice(point.revenueCents, 'en')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </section>
          )}

          {/* ── Awaiting confirmation ──────────────────────────────────────── */}
          {showOrders && (
            <section aria-labelledby="queue-heading">
              <div className="flex items-center justify-between gap-3">
                <h2
                  id="queue-heading"
                  className="flex items-center gap-1.5 font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
                >
                  <Clock className="size-3.5" aria-hidden="true" />
                  Awaiting confirmation
                </h2>
                <Link
                  href="/admin/orders?status=pending"
                  className="rounded-sm text-xs text-forest-800 underline underline-offset-4"
                >
                  See all pending
                </Link>
              </div>

              {data.awaitingConfirmation.length === 0 ? (
                <p className="mt-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink-600">
                  Nothing waiting. Every order has been confirmed.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
                  {data.awaitingConfirmation.map((order) => {
                    const placed = formatAdminDateTime(order.placedAt);
                    return (
                      <li
                        key={order.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="rounded-sm text-sm font-medium text-forest-800 underline underline-offset-4"
                            data-numeric
                          >
                            {order.orderNumber}
                          </Link>
                          <span className="block text-xs text-ink-500">
                            {order.recipientName || '—'} ·{' '}
                            <time dateTime={order.placedAt} title={placed.utc} data-numeric>
                              {placed.display}
                            </time>
                          </span>
                        </div>
                        <span className="text-sm font-medium whitespace-nowrap" data-numeric>
                          {formatPrice(order.totalCents, 'en')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* ── Side column ──────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-8">
          {showOrders && (
            <section aria-labelledby="status-heading">
              <h2
                id="status-heading"
                className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
              >
                Orders by status
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
                {Object.entries(data.statusCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => (
                    <li key={status} className="flex items-center justify-between gap-3 px-3 py-2">
                      <Link
                        href={`/admin/orders?status=${status}`}
                        className="rounded-sm text-ink-900 hover:text-forest-800"
                      >
                        {ORDER_STATUS_LABELS[status] ?? status}
                      </Link>
                      <span className="font-medium" data-numeric>
                        {count}
                      </span>
                    </li>
                  ))}
                {Object.keys(data.statusCounts).length === 0 && (
                  <li className="px-3 py-2 text-ink-600">No orders in the last 30 days.</li>
                )}
              </ul>
            </section>
          )}

          {showStock && (
            <section aria-labelledby="stock-heading">
              <h2
                id="stock-heading"
                className="flex items-center gap-1.5 font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
              >
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Low stock
              </h2>

              {data.lowStock.length === 0 ? (
                <p className="mt-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink-600">
                  Everything is above its threshold.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
                  {data.lowStock.map((item) => (
                    <li
                      key={item.sku}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-ink-900">{item.productName}</span>
                        <span className="block text-xs text-ink-500" data-numeric>
                          {item.sku}
                        </span>
                      </span>
                      <span className="whitespace-nowrap" data-numeric>
                        <strong className={item.onHand === 0 ? 'text-error' : 'text-warning'}>
                          {item.onHand}
                        </strong>
                        <span className="text-ink-500"> / {item.threshold}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  window: data,
  showRevenue,
}: {
  label: string;
  window: KpiWindow;
  showRevenue: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold text-forest-900" data-numeric>
        {showRevenue ? formatPrice(data.revenueCents, 'en') : data.orders}
      </p>
      <p className="mt-0.5 text-xs text-ink-600" data-numeric>
        {showRevenue
          ? `${data.orders} order${data.orders === 1 ? '' : 's'}${
              // An AOV over zero orders is not zero, it is undefined — say nothing rather than
              // print a figure an operator might act on.
              data.aovCents != null ? ` · ${formatPrice(data.aovCents, 'en')} average` : ''
            }`
          : `order${data.orders === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}
