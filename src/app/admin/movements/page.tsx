import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, ScrollText } from 'lucide-react';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { countLedgerDrift, listMovements, MOVEMENTS_PAGE_SIZE } from '@/features/inventory/queries';
import { MOVEMENT_LABELS } from '@/features/inventory/copy';
import { MOVEMENT_TYPES, toMovementType } from '@/features/inventory/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Stock movements' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * docs/06 §8 — the full ledger.
 *
 * Append-only and read-only. There is no edit control anywhere on this page, and that is the
 * feature: `on_hand` is derived from these rows, so a ledger you can edit is a stock figure you
 * cannot trust. A wrong movement is corrected by a compensating adjustment, which leaves both
 * rows visible — which is what an auditor, or the person doing next quarter's stock count,
 * actually needs to see.
 */
export default async function AdminMovementsPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'inventory.manage')) redirect('/admin');

  const typeParam = first(params.type);
  const type = typeParam ? toMovementType(typeParam) : undefined;
  const from = first(params.from);
  const to = first(params.to);
  const variantId = first(params.variant);
  const before = first(params.before);

  const [{ rows, nextCursor }, drift] = await Promise.all([
    listMovements({ type, from, to, variantId, before }),
    countLedgerDrift(),
  ]);

  function href(next: { type?: string; before?: string }): string {
    const query = new URLSearchParams();
    const nextType = 'type' in next ? next.type : typeParam;
    if (nextType) query.set('type', nextType);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (variantId) query.set('variant', variantId);
    if (next.before) query.set('before', next.before);
    const qs = query.toString();
    return qs ? `/admin/movements?${qs}` : '/admin/movements';
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-carbon-900">Stock movements</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Every change to stock, in order. Sales and restocks are written by the shop; received
            and adjusted rows are written by people.
          </p>
        </div>
        <Link
          href="/admin/inventory"
          className="rounded-sm text-sm text-carbon-800 underline underline-offset-4"
        >
          Stock levels
        </Link>
      </div>

      {/*
        docs/09 §1 makes "on-hand equals the sum of movements" an invariant the integration suite
        asserts. Showing it here too means a drift caused in production — by a migration, a manual
        SQL fix, a bug — is visible to the person who would notice, rather than waiting for
        somebody to run the test suite.
      */}
      {drift > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-error bg-error/10 p-3 text-sm text-ink-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />
          <span>
            <span data-numeric>{drift}</span> stock record{drift === 1 ? ' does' : 's do'} not match
            the ledger. On-hand should always equal the sum of movements — this needs an engineer,
            not a stock count.
          </span>
        </p>
      )}

      <nav aria-label="Filter by movement type" className="mt-6 flex flex-wrap gap-1.5">
        {[undefined, ...MOVEMENT_TYPES].map((value) => {
          const active = value === type;
          return (
            <Link
              key={value ?? 'all'}
              href={href({ type: value })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
              )}
            >
              {value ? MOVEMENT_LABELS[value] : 'All'}
            </Link>
          );
        })}
      </nav>

      <form action="/admin/movements" className="mt-3 flex flex-wrap items-end gap-2">
        {type && <input type="hidden" name="type" value={type} />}
        {variantId && <input type="hidden" name="variant" value={variantId} />}
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-ink-900">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-ink-900">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-sm border border-line-strong px-3 text-sm text-ink-900 hover:bg-carbon-50"
        >
          Apply
        </button>
        {(from || to) && (
          <Link
            href={href({})}
            className="h-9 rounded-sm px-2 py-1.5 text-sm text-carbon-800 underline underline-offset-4"
          >
            Clear dates
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <ScrollText className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-carbon-900">No movements in this view</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Widen the dates, or clear the filters to see the whole ledger.
          </p>
        </div>
      ) : (
        <>
          <div
            className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
            tabIndex={0}
            role="region"
            aria-label="Stock movements"
          >
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <caption className="sr-only">Stock movements, newest first</caption>
              <thead>
                <tr className="border-b border-line bg-carbon-50 text-left">
                  {['When', 'Product', 'SKU', 'Type', 'Qty', 'Batch', 'Note', 'By'].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-3 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const when = formatAdminDateTime(row.createdAt);
                  return (
                    <tr key={row.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5 whitespace-nowrap text-ink-600">
                        <time dateTime={row.createdAt} title={when.utc} data-numeric>
                          {when.display}
                        </time>
                      </td>
                      <td className="px-3 py-2.5 text-ink-900">{row.productName}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink-600">{row.sku}</td>
                      <td className="px-3 py-2.5 text-ink-600">{MOVEMENT_LABELS[row.type]}</td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-medium',
                          row.quantity > 0 ? 'text-success' : 'text-error',
                        )}
                        data-numeric
                      >
                        {row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-600">
                        {row.batchNumber ?? '—'}
                        {row.expiryDate && (
                          <span className="block text-ink-500" data-numeric>
                            exp {row.expiryDate}
                          </span>
                        )}
                      </td>
                      <td className="max-w-56 px-3 py-2.5 text-xs text-ink-600">
                        {row.note ?? (row.referenceType ? `${row.referenceType} reference` : '—')}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-500">
                        {/* No actor means the shop wrote it — checkout, cancel or refund. */}
                        {row.actorEmail ?? 'System'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Link
                href={href({ before: nextCursor })}
                className="inline-flex h-9 items-center rounded-sm border border-line-strong px-4 text-sm text-ink-900 hover:bg-carbon-50"
              >
                Older movements
              </Link>
            </div>
          )}
          <p className="mt-2 text-center text-xs text-ink-500">
            <span data-numeric>{rows.length}</span> of up to{' '}
            <span data-numeric>{MOVEMENTS_PAGE_SIZE}</span> per page
          </p>
        </>
      )}
    </div>
  );
}
