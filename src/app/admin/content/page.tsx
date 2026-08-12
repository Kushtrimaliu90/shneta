import Link from 'next/link';
import type { Metadata } from 'next';
import { FileText, Plus } from 'lucide-react';
import { formatAdminDateTime } from '@/features/admin/copy';
import { countRemovedArticles, listAdminArticles } from '@/features/content/admin-queries';
import { restoreArticle } from '@/features/content/editor-actions';
import { CONTENT_ERRORS } from '@/features/content/components/content-fields';
import { RestoreControl } from '@/components/ui/remove-control';
import { Trash2 } from 'lucide-react';
import { ARTICLE_STATUSES, toArticleStatus } from '@/features/content/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Articles' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

const STATUS_TONES: Record<string, string> = {
  draft: 'bg-ink-600 text-white',
  in_review: 'bg-warning text-white',
  published: 'bg-success text-white',
  archived: 'bg-ink-600 text-white',
};

/** docs/06 §13 — the article list. The layout has already checked the capability. */
export default async function AdminArticlesPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status = raw ? toArticleStatus(raw) : undefined;
  // `?removed=1` is its own view, not a fifth status — an article keeps its status while it is in the bin.
  const removed = (Array.isArray(params.removed) ? params.removed[0] : params.removed) === '1';

  const [rows, removedCount] = await Promise.all([
    listAdminArticles(removed ? undefined : status, removed),
    countRemovedArticles(),
  ]);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {[undefined, ...ARTICLE_STATUSES].map((value) => {
            const active = !removed && value === status;
            return (
              <Link
                key={value ?? 'all'}
                href={value ? `/admin/content?status=${value}` : '/admin/content'}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs transition-colors',
                  active
                    ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                    : 'border-line-strong text-ink-600 hover:bg-forest-50',
                )}
              >
                {value ? STATUS_LABELS[value] : 'All'}
              </Link>
            );
          })}

          {/*
            The bin, set apart. A different axis from the status tabs: those ask where an article is in
            its life, this one leaves that question behind. Shown at zero so somebody who has just
            removed an article knows where it went.
          */}
          <span aria-hidden="true" className="mx-1 self-center text-line-strong">
            |
          </span>
          <Link
            href="/admin/content?removed=1"
            aria-current={removed ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors',
              removed
                ? 'border-error bg-error/10 font-medium text-error'
                : 'border-line-strong text-ink-600 hover:bg-forest-50',
            )}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Removed {removedCount}
          </Link>
        </nav>

        <Link
          href="/admin/content/articles/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-forest-800 px-3.5 text-sm text-white hover:bg-forest-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          New article
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <FileText className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">Nothing in this view</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Write one, or clear the filter to see everything.
          </p>
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Articles"
        >
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Articles, most recently edited first</caption>
            <thead>
              <tr className="border-b border-line bg-forest-50 text-left">
                {['Title', 'Kind', 'Status', 'Updated', ...(removed ? ['Removed on', ''] : [])].map(
                  (heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const updated = formatAdminDateTime(row.updatedAt);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/content/articles/${row.id}`}
                        className="rounded-sm font-medium text-forest-800 underline underline-offset-4"
                      >
                        {row.titleSq || row.slug}
                      </Link>
                      <span className="block text-xs text-ink-500">/{row.slug}</span>
                      {!row.hasEnglish && (
                        <span className="text-xs text-warning">No English title</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{row.type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
                          STATUS_TONES[row.status] ?? 'bg-ink-600 text-white',
                        )}
                      >
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                      <time dateTime={row.updatedAt} title={updated.utc} data-numeric>
                        {updated.display}
                      </time>
                    </td>

                    {removed && (
                      <>
                        <td className="px-4 py-3 whitespace-nowrap text-ink-600">
                          {row.deletedAt ? (
                            <time dateTime={row.deletedAt} data-numeric>
                              {formatAdminDateTime(row.deletedAt).display}
                            </time>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <RestoreControl
                            action={restoreArticle}
                            hiddenFields={{ articleId: row.id }}
                            errorCopy={CONTENT_ERRORS}
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
    </section>
  );
}
