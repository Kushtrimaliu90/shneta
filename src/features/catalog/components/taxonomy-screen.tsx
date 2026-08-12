import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can, type Capability } from '@/features/admin/roles';
import { listRemovedTaxonomy, listTaxonomy } from '@/features/catalog/taxonomy-queries';
import { restoreTaxonomy } from '@/features/catalog/taxonomy-actions';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { RestoreControl } from '@/components/ui/remove-control';
import { formatAdminDateTime } from '@/features/admin/copy';
import { TAXONOMY_CONFIG } from '@/features/catalog/taxonomy-config';
import { TaxonomyAdmin } from '@/features/catalog/components/taxonomy-admin';
import type { TaxonomyKind } from '@/features/catalog/taxonomy-actions';
import { clientEnv } from '@/lib/env.client';

/**
 * The server half of a taxonomy screen: guard, read, count, render.
 *
 * Four route files that each did this would be four places to forget the capability check. Here
 * the check is one line the route supplies, and the route file is short enough to read whole.
 */
export async function TaxonomyScreen({
  kind,
  capability,
}: {
  kind: TaxonomyKind;
  capability: Capability;
}) {
  const profile = await getProfile();
  if (!can(profile?.role, capability)) redirect('/admin');

  const config = TAXONOMY_CONFIG[kind];
  const rows = await listTaxonomy(kind);
  /*
   * Only brands and categories have a bin — the other two kinds have no `deleted_at` column, so there is
   * nothing to read. An empty array keeps the JSX below free of a second condition.
   */
  const removed =
    kind === 'brand' || kind === 'category' ? await listRemovedTaxonomy(kind) : [];

  const active = rows.filter((row) => row.isActive).length;
  const untranslated = config.bilingualName ? rows.filter((row) => !row.nameEn).length : 0;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">{config.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">{config.intro}</p>

      <p className="mt-2 text-xs text-ink-600">
        <span data-numeric>{rows.length}</span> total · <span data-numeric>{active}</span> visible
        to customers
        {untranslated > 0 && (
          <>
            {' · '}
            {/*
              Counted in the header rather than only marked per row, because "how much of the
              catalogue is still Albanian-only" is a question with a number for an answer, and
              scrolling a list to count amber labels is not how anyone should get it.
            */}
            <span className="text-warning">
              <span data-numeric>{untranslated}</span> without an English name
            </span>
          </>
        )}
      </p>

      <div className="mt-6">
        <TaxonomyAdmin
          kind={kind}
          rows={rows}
          parents={
            config.hasParent
              ? rows.map((row) => ({ id: row.id, name: row.nameSq || row.slug }))
              : []
          }
          logoBaseUrl={
            config.hasLogo
              ? `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/brand-assets`
              : undefined
          }
        />
      </div>

      {/*
        The bin, at the foot of the screen and only when it has something in it.

        Collapsed into a `<details>` rather than given a tab: unlike products, these lists are short and
        removals here are rare — a permanent empty section would be noise on every visit, while a tab
        would imply a filter over something worth filtering. It appears when it has contents and says
        nothing otherwise.
      */}
      {removed.length > 0 && (
        <details className="mt-8 rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-900">
            Removed ({removed.length})
          </summary>
          <p className="mt-2 text-xs text-ink-600">
            Gone from the shop and from the list above. Nothing was deleted — each of these still holds
            its web address, and Restore puts it back exactly as it was.
          </p>
          <ul className="mt-3 divide-y divide-line">
            {removed.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-ink-900">{row.name}</p>
                  <p className="text-xs text-ink-500">
                    {row.slug}
                    {row.deletedAt && (
                      <>
                        {' · removed '}
                        <time dateTime={row.deletedAt} data-numeric>
                          {formatAdminDateTime(row.deletedAt).display}
                        </time>
                      </>
                    )}
                  </p>
                </div>
                <RestoreControl
                  action={restoreTaxonomy}
                  hiddenFields={{ kind, id: row.id }}
                  errorCopy={CATALOG_ERRORS}
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
