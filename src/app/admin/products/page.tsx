import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertTriangle, Search, Trash2 } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import {
  countAdminProductsByStatus,
  countRemovedProducts,
  getEditorOptions,
  listAdminProducts,
  PRODUCT_STATUSES,
  toProductStatus,
} from '@/features/catalog/admin-queries';
import { NewProductForm } from '@/features/catalog/components/new-product-form';
import { RestoreControl } from '@/components/ui/remove-control';
import { restoreProduct } from '@/features/catalog/admin-actions';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Products' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

const STATUS_TONES: Record<string, string> = {
  draft: 'bg-ink-600 text-white',
  pending_review: 'bg-warning text-white',
  published: 'bg-success text-white',
  archived: 'bg-error text-white',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

/**
 * docs/06 §3 — the product list.
 *
 * Same shape as the orders list: URL-driven filters, a real `<table>`, a GET search form, no
 * client state. An operator can send "everything still in draft" as a link.
 *
 * The column that earns its place is **Ready**. `guard_product_publish` refuses to publish
 * without an active variant, an image, a primary category and approval — so the list shows how
 * far each draft is from meeting that, rather than making the operator open twenty products to
 * find the three that are nearly done.
 */
export default async function AdminProductsPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'products.manage')) redirect('/admin');

  const statusParam = first(params.status);
  const status = toProductStatus(statusParam);
  const search = first(params.q);
  /*
   * `?removed=1` is its own view, not a fifth status.
   *
   * A removed product keeps whatever status it had and returns to it when restored, so the two are
   * orthogonal — and a removal that could not be seen afterwards would be a reversible action with no
   * way to reverse it.
   */
  const removed = first(params.removed) === '1';

  const [rows, counts, removedCount, options] = await Promise.all([
    listAdminProducts({ status: removed ? undefined : status, search, removed }),
    countAdminProductsByStatus(),
    countRemovedProducts(),
    getEditorOptions(),
  ]);

  function href(next: { status?: string; removed?: boolean }): string {
    const query = new URLSearchParams();
    const nextRemoved = 'removed' in next ? next.removed : removed;
    // The status filter does not apply to the removed view, and carrying it would look like it did.
    if (nextRemoved) query.set('removed', '1');
    else {
      const nextStatus = 'status' in next ? next.status : statusParam;
      if (nextStatus) query.set('status', nextStatus);
    }
    if (search) query.set('q', search);
    const qs = query.toString();
    return qs ? `/admin/products?${qs}` : '/admin/products';
  }

  const tabs = [
    { key: undefined, label: 'All', count: counts.all ?? 0 },
    ...PRODUCT_STATUSES.map((value) => ({
      key: value,
      label: STATUS_LABELS[value] ?? value,
      count: counts[value] ?? 0,
    })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">Products</h1>
          <p className="mt-1 text-sm text-ink-600">
            {counts.all ?? 0} product{(counts.all ?? 0) === 1 ? '' : 's'} in the catalogue
          </p>
        </div>

        <form action="/admin/products" className="flex items-end gap-2">
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
              placeholder="Name or slug"
              className="mt-1 h-10 w-56 rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-500"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-sm bg-forest-800 px-3.5 text-sm font-medium text-white hover:bg-forest-700"
          >
            <Search className="size-4" aria-hidden="true" />
            Search
          </button>
        </form>
      </div>

      {/*
        Below the header rather than beside it: when the form opens it needs the full width for
        three fields, and a control that reflows the header when clicked is disorienting.
      */}
      <div className="mt-4">
        <NewProductForm brands={options.brands} />
      </div>

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = !removed && (tab.key === statusParam || (!tab.key && !statusParam));
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.key, removed: false })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                  : 'border-line-strong text-ink-600 hover:bg-forest-50',
              )}
            >
              {tab.label}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {tab.count}
              </span>
            </Link>
          );
        })}

        {/*
          The bin, set apart from the status tabs.

          Separated by a divider because it is a different axis: the tabs above filter by where a product
          is in its life, and this one leaves that question behind entirely. Shown even at zero, so an
          operator who has just removed something knows where it went — a tab that appears only when
          occupied is a tab nobody finds the first time.
        */}
        <span aria-hidden="true" className="mx-1 self-center text-line-strong">
          |
        </span>
        <Link
          href={href({ removed: true })}
          aria-current={removed ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
            removed
              ? 'border-error bg-error/10 font-medium text-error'
              : 'border-line-strong text-ink-600 hover:bg-forest-50',
          )}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Removed
          <span className="font-ui text-xs text-ink-600" data-numeric>
            {removedCount}
          </span>
        </Link>
      </nav>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <p className="font-medium text-forest-900">No products match this view</p>
          <p className="mt-1.5 text-sm text-ink-600">
            {removed
              ? 'Nothing has been removed. Anything you remove lands here and can be put back.'
              : search || statusParam
                ? 'Try a different status or clear the search.'
                : 'The catalogue is empty.'}
          </p>
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Products"
        >
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              Products{statusParam ? ` with status ${statusParam}` : ''}, most recently edited first
            </caption>
            <thead>
              <tr className="border-b border-line bg-forest-50 text-left">
                {[
                  'Product',
                  'Brand',
                  'Status',
                  'Ready',
                  'From',
                  'Edited',
                  // Only in the bin, where it is the one thing an operator came here to do.
                  ...(removed ? ['Removed on', ''] : []),
                ].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn(
                      'px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase',
                      heading === 'From' && 'text-right',
                    )}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const edited = formatAdminDateTime(row.updatedAt);
                /*
                 * Only the two conditions this row can answer. Approval and primary category
                 * need per-product reads the list deliberately does not make — the editor's
                 * checklist is the complete answer, and a list that lies by omission would be
                 * worse than one that says less.
                 */
                const missing = [
                  row.variantCount === 0 ? 'variant' : null,
                  row.imageCount === 0 ? 'image' : null,
                ].filter(Boolean);

                return (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-forest-50/60"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/products/${row.id}`}
                        className="rounded-sm font-medium text-forest-800 underline underline-offset-4"
                      >
                        {pickLocale(row.name, 'en') || row.slug}
                      </Link>
                      <span className="block text-xs text-ink-500">
                        {/*
                          The slug doubles as a link to the live page for published products —
                          "show me what the customer sees" is the other thing an operator wants
                          from a catalogue row, and it saves them assembling the URL by hand.
                        */}
                        {row.status === 'published' ? (
                          <Link
                            href={`/en/product/${row.slug}`}
                            target="_blank"
                            className="rounded-sm text-forest-800 underline underline-offset-4"
                          >
                            {row.slug} ↗
                          </Link>
                        ) : (
                          row.slug
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{row.brandName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold whitespace-nowrap',
                          STATUS_TONES[row.status] ?? 'bg-ink-600 text-white',
                        )}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {missing.length === 0 ? (
                        <span className="text-xs text-ink-600">
                          {row.variantCount} variant{row.variantCount === 1 ? '' : 's'} ·{' '}
                          {row.imageCount} image{row.imageCount === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-warning">
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                          Needs {missing.join(' and ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" data-numeric>
                      {row.priceFromCents != null ? formatPrice(row.priceFromCents, 'en') : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                      <time dateTime={row.updatedAt} title={edited.utc} data-numeric>
                        {edited.display}
                      </time>
                    </td>

                    {removed && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                          {row.deletedAt ? (
                            <time
                              dateTime={row.deletedAt}
                              title={formatAdminDateTime(row.deletedAt).utc}
                              data-numeric
                            >
                              {formatAdminDateTime(row.deletedAt).display}
                            </time>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <RestoreControl
                            action={restoreProduct}
                            hiddenFields={{ productId: row.id }}
                            errorCopy={CATALOG_ERRORS}
                          />
                        </td>
                      </>
                    )}
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
