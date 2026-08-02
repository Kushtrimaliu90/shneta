import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Search } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime, PROVIDER_LABELS } from '@/features/admin/copy';
import { OrderStatusBadge, PaymentStatusBadge } from '@/features/admin/components/status-badge';
import { countOrdersByStatus, listOrders, ORDERS_PAGE_SIZE } from '@/features/orders/queries';
import { ORDER_STATUSES, toOrderStatus } from '@/features/orders/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Orders' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * docs/06 §2 — the orders list.
 *
 * **Filters live in the URL**, not in client state, for the same reasons as the storefront PLP:
 * a support agent can send a colleague "the pending queue" as a link, the back button works,
 * and the whole table stays a Server Component with no JavaScript. The tabs are links, the
 * search is a GET form, and pagination is a link carrying a keyset cursor.
 *
 * The layout already proved the visitor is staff. This additionally checks the *capability*,
 * because staff is not one thing: docs/01 §3 gives orders to support, warehouse and admin, and
 * a content manager who typed the URL must not read customer addresses.
 */
export default async function AdminOrdersPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  // Sent to the dashboard rather than a forbidden page — every staff role can see that.
  if (!can(profile?.role, 'orders.view')) redirect('/admin');

  const statusParam = first(params.status);
  const status = statusParam ? toOrderStatus(statusParam) : undefined;
  const search = first(params.q);
  const before = first(params.before);

  const [{ rows, nextCursor }, counts] = await Promise.all([
    listOrders({ status, search, before }),
    countOrdersByStatus(),
  ]);

  /** Preserves the active filters when building a tab or pagination link. */
  function href(next: { status?: string; q?: string; before?: string }): string {
    const query = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : statusParam;
    const nextSearch = 'q' in next ? next.q : search;

    if (nextStatus) query.set('status', nextStatus);
    if (nextSearch) query.set('q', nextSearch);
    // A cursor is never carried across a filter change — it belongs to the old result set.
    if (next.before) query.set('before', next.before);

    const qs = query.toString();
    return qs ? `/admin/orders?${qs}` : '/admin/orders';
  }

  const tabs = [
    { key: undefined, label: 'All', count: counts.all ?? 0 },
    ...ORDER_STATUSES.map((value) => ({
      key: value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      count: counts[value] ?? 0,
    })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-carbon-900">Orders</h1>
          <p className="mt-1 text-sm text-ink-600">
            {counts.all ?? 0} order{(counts.all ?? 0) === 1 ? '' : 's'} in total
          </p>
        </div>

        {/* A real GET form: no JavaScript, and the result is a shareable URL. */}
        <form action="/admin/orders" className="flex items-end gap-2">
          {statusParam && <input type="hidden" name="status" value={statusParam} />}
          <div>
            <label htmlFor="q" className="block text-xs font-medium text-ink-600">
              Search
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="Order number or email"
              className="mt-1 h-10 w-64 rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-500"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-carbon-800 px-3.5 text-sm font-medium text-white hover:bg-carbon-700"
          >
            <Search className="size-4" aria-hidden="true" />
            Search
          </button>
        </form>
      </div>

      {/* Status tabs with live counts (docs/06 §2). */}
      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = tab.key === statusParam || (!tab.key && !statusParam);
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.key })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
              )}
            >
              {tab.label}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {tab.count}
              </span>
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <p className="font-medium text-carbon-900">No orders match this view</p>
          <p className="mt-1.5 text-sm text-ink-600">
            {search || statusParam
              ? 'Try a different status or clear the search.'
              : 'Orders will appear here as customers place them.'}
          </p>
          {(search || statusParam) && (
            <Link
              href="/admin/orders"
              className="mt-4 inline-block rounded-sm text-sm text-carbon-800 underline underline-offset-4"
            >
              Clear filters
            </Link>
          )}
        </div>
      ) : (
        <>
          {/*
            A real <table> with scope'd headers, not a grid of divs. Screen readers announce
            row and column context from it for free, and an operator can copy a column out
            into a spreadsheet — which is what they will do before any CSV export exists.
          */}
          <div
            className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
            tabIndex={0}
            role="region"
            aria-label="Orders"
          >
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">
                Orders{statusParam ? ` with status ${statusParam}` : ''}, newest first
              </caption>
              <thead>
                <tr className="border-b border-line bg-carbon-50 text-left">
                  <th
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Order
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Placed
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Customer
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Payment
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-right font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const placed = formatAdminDateTime(row.placedAt);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-line last:border-0 hover:bg-carbon-50/60"
                    >
                      <td className="px-4 py-3">
                        {/*
                          The link wraps the order number rather than the row: a row-wide
                          click target cannot be reached by keyboard without ARIA gymnastics,
                          and nesting the other cells' content inside an anchor would make
                          the email unselectable.
                        */}
                        <Link
                          href={`/admin/orders/${row.id}`}
                          className="rounded-sm font-medium text-carbon-800 underline underline-offset-4"
                          data-numeric
                        >
                          {row.orderNumber}
                        </Link>
                        <span className="block text-xs text-ink-500">
                          {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                          {row.provider
                            ? ` · ${PROVIDER_LABELS[row.provider] ?? row.provider}`
                            : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                        <time dateTime={row.placedAt} title={placed.utc} data-numeric>
                          {placed.display}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-ink-900">{row.recipientName || '—'}</span>
                        <span className="block text-xs text-ink-500">{row.email}</span>
                      </td>
                      <td className="px-4 py-3">
                        <OrderStatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={row.paymentStatus} />
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium whitespace-nowrap"
                        data-numeric
                      >
                        {formatPrice(row.totalCents, 'en')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-ink-600">
            <p>
              Showing {rows.length} of {counts.all ?? 0}
              {rows.length === ORDERS_PAGE_SIZE ? ' — more on the next page' : ''}
            </p>
            {nextCursor && (
              <Link
                href={href({ before: nextCursor })}
                className="rounded-sm border border-line-strong px-3 py-1.5 hover:bg-carbon-50"
              >
                Older orders →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
