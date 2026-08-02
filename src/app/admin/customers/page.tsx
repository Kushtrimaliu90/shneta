import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Search, Users } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { CUSTOMERS_PAGE_SIZE, listCustomers } from '@/features/customers/queries';

export const metadata: Metadata = { title: 'Customers' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** docs/06 §9 — the customer list: search, orders, lifetime value, points, joined. */
export default async function AdminCustomersPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'customers.view')) redirect('/admin');

  const search = first(params.q);
  const page = Number(first(params.page) ?? 0) || 0;

  const { rows, hasMore } = await listCustomers({ search, page });

  function href(next: number): string {
    const query = new URLSearchParams();
    if (search) query.set('q', search);
    if (next > 0) query.set('page', String(next));
    const qs = query.toString();
    return qs ? `/admin/customers?${qs}` : '/admin/customers';
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Customers</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Everyone with an account. Lifetime value counts delivered and in-flight orders — cancelled
        and refunded ones are excluded, so the number means what it says.
      </p>

      <form action="/admin/customers" className="mt-6 flex items-center gap-2">
        <label htmlFor="customer-search" className="sr-only">
          Search by email, name or phone
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-500"
            aria-hidden="true"
          />
          <input
            id="customer-search"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Email, name or phone"
            className="h-9 w-72 rounded-sm border border-line-strong bg-surface pr-3 pl-8 text-sm text-ink-900"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-sm border border-line-strong px-3 text-sm text-ink-900 hover:bg-forest-50"
        >
          Search
        </button>
        {search && (
          <Link
            href="/admin/customers"
            className="text-sm text-forest-800 underline underline-offset-4"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Users className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">
            {search ? 'Nobody matches that' : 'No customers yet'}
          </p>
          <p className="mt-1.5 text-sm text-ink-600">
            {search
              ? 'Try part of an email address, or clear the search.'
              : 'Accounts appear here as soon as someone signs up.'}
          </p>
        </div>
      ) : (
        <>
          <div
            className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
            tabIndex={0}
            role="region"
            aria-label="Customers"
          >
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">Customers, newest first</caption>
              <thead>
                <tr className="border-b border-line bg-forest-50 text-left">
                  {['Customer', 'Orders', 'Lifetime', 'Points', 'Subs', 'Joined'].map((heading) => (
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
                  const joined = formatAdminDateTime(row.createdAt);
                  return (
                    <tr key={row.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/customers/${row.id}`}
                          className="rounded-sm font-medium text-forest-800 underline underline-offset-4"
                        >
                          {row.fullName || row.email}
                        </Link>
                        <span className="block text-xs text-ink-500">{row.email}</span>
                        {row.deletedAt && (
                          <span className="mt-0.5 inline-flex rounded-sm bg-ink-600 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
                            Erased
                          </span>
                        )}
                        {row.role !== 'customer' && (
                          <span className="mt-0.5 ml-1 inline-flex rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900">
                            Staff
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-600" data-numeric>
                        {row.ordersCount}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-900" data-numeric>
                        {formatPrice(row.lifetimeCents, 'sq')}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-600" data-numeric>
                        {row.loyaltyPoints}
                      </td>
                      <td className="px-4 py-3 text-right text-ink-600" data-numeric>
                        {row.activeSubscriptions || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                        <time dateTime={row.createdAt} title={joined.utc} data-numeric>
                          {joined.display}
                        </time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(page > 0 || hasMore) && (
            <div className="mt-4 flex items-center justify-between">
              {page > 0 ? (
                <Link
                  href={href(page - 1)}
                  className="inline-flex h-9 items-center rounded-sm border border-line-strong px-4 text-sm text-ink-900 hover:bg-forest-50"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-ink-500">
                Page <span data-numeric>{page + 1}</span> ·{' '}
                <span data-numeric>{CUSTOMERS_PAGE_SIZE}</span> per page
              </span>
              {hasMore ? (
                <Link
                  href={href(page + 1)}
                  className="inline-flex h-9 items-center rounded-sm border border-line-strong px-4 text-sm text-ink-900 hover:bg-forest-50"
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
