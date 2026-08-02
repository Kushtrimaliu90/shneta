import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, Search } from 'lucide-react';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { InventoryTable } from '@/features/inventory/components/inventory-table';
import { countInventoryByStatus, listInventory } from '@/features/inventory/queries';
import { STOCK_STATUS_LABELS } from '@/features/inventory/copy';
import { STOCK_STATUSES, toStockStatus } from '@/features/inventory/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Inventory' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * docs/06 §8 — the stock table.
 *
 * Filters in the URL like every other admin list, so "everything that is out of stock" is a link
 * a warehouse manager can bookmark or send to a colleague, and the table stays a Server
 * Component.
 */
export default async function AdminInventoryPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'inventory.manage')) redirect('/admin');

  const statusParam = first(params.status);
  const status = statusParam ? toStockStatus(statusParam) : undefined;
  const search = first(params.q);

  const [rows, counts] = await Promise.all([
    listInventory({ status, search }),
    countInventoryByStatus(),
  ]);

  function href(next: { status?: string; q?: string }): string {
    const query = new URLSearchParams();
    const nextStatus = 'status' in next ? next.status : statusParam;
    const nextSearch = 'q' in next ? next.q : search;
    if (nextStatus) query.set('status', nextStatus);
    if (nextSearch) query.set('q', nextSearch);
    const qs = query.toString();
    return qs ? `/admin/inventory?${qs}` : '/admin/inventory';
  }

  const outOfStock = counts.out ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">Inventory</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            On-hand counts per variant. Every change here writes a ledger row — receive what
            arrives, adjust what does not match the shelf, and say why.
          </p>
        </div>
        <Link
          href="/admin/movements"
          className="rounded-sm text-sm text-forest-800 underline underline-offset-4"
        >
          Stock movements
        </Link>
      </div>

      {/*
        Surfaced rather than left to the tab count: something being unsellable right now is the
        one fact on this page that costs money by the hour.
      */}
      {outOfStock > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning bg-warning/10 p-3 text-sm text-ink-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span data-numeric>{outOfStock}</span> variant{outOfStock === 1 ? '' : 's'} cannot be
            bought right now.{' '}
            <Link href={href({ status: 'out' })} className="underline underline-offset-4">
              Show them
            </Link>
            .
          </span>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by stock status" className="flex flex-wrap gap-1.5">
          {[undefined, ...STOCK_STATUSES].map((value) => {
            const active = value === status;
            return (
              <Link
                key={value ?? 'all'}
                href={href({ status: value })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                  active
                    ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                    : 'border-line-strong text-ink-600 hover:bg-forest-50',
                )}
              >
                {value ? STOCK_STATUS_LABELS[value] : 'All'}
                <span className="font-ui text-xs text-ink-600" data-numeric>
                  {value ? (counts[value] ?? 0) : (counts.all ?? 0)}
                </span>
              </Link>
            );
          })}
        </nav>

        <form action="/admin/inventory" className="flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <label htmlFor="inventory-search" className="sr-only">
            Search by SKU or product
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-500"
              aria-hidden="true"
            />
            <input
              id="inventory-search"
              name="q"
              defaultValue={search ?? ''}
              placeholder="SKU or product"
              className="h-9 w-56 rounded-sm border border-line-strong bg-surface pr-3 pl-8 text-sm text-ink-900"
            />
          </div>
          <button
            type="submit"
            className="h-9 rounded-sm border border-line-strong px-3 text-sm text-ink-900 hover:bg-forest-50"
          >
            Search
          </button>
        </form>
      </div>

      <InventoryTable rows={rows} />
    </div>
  );
}
