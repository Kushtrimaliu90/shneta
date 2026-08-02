import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can, type Capability } from '@/features/admin/roles';
import { listTaxonomy } from '@/features/catalog/taxonomy-queries';
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
    </div>
  );
}
