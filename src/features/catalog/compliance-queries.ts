import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';

/**
 * docs/06 §14 — the compliance queue.
 *
 * Everything a reviewer needs to decide, in one query, so the queue is a place to work rather
 * than a list of links to open. What they are deciding is whether the wording on this product is
 * lawful for a food supplement (docs/08 §7), so the claim-bearing fields come with the row.
 */

export interface ComplianceItem {
  id: string;
  slug: string;
  name: LocalizedField;
  brandName: string;
  submittedAt: string;
  description: LocalizedField;
  howToUse: LocalizedField;
  warnings: LocalizedField;
  certifications: string[];
  ingredientNames: LocalizedField[];
  /** Already approved once and edited since — the review is a re-review. */
  previouslyApproved: boolean;
}

interface RawRow {
  id: string;
  slug: string;
  name: unknown;
  description: unknown;
  how_to_use: unknown;
  warnings: unknown;
  updated_at: string;
  approved_by: string | null;
  brands: { name: string } | null;
  product_certifications: { certifications: { name: unknown } | null }[];
  product_ingredients: { ingredients: { name: unknown } | null }[];
}

export async function listComplianceQueue(): Promise<ComplianceItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('products')
    .select(
      `id, slug, name, description, how_to_use, warnings, updated_at, approved_by,
       brands ( name ),
       product_certifications ( certifications ( name ) ),
       product_ingredients ( ingredients ( name ) )`,
    )
    .eq('status', 'pending_review')
    .is('deleted_at', null)
    // Oldest first: a queue that shows the newest submission first is a queue where the oldest
    // item is never reached.
    .order('updated_at', { ascending: true })
    .limit(50);

  if (error) {
    logger.error('listComplianceQueue failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: asLocalizedField(row.name),
    brandName: row.brands?.name ?? '—',
    submittedAt: row.updated_at,
    description: asLocalizedField(row.description),
    howToUse: asLocalizedField(row.how_to_use),
    warnings: asLocalizedField(row.warnings),
    certifications: row.product_certifications.flatMap((link) => {
      const name = asLocalizedField(link.certifications?.name);
      return name?.en || name?.sq ? [name.en ?? name.sq ?? ''] : [];
    }),
    ingredientNames: row.product_ingredients.flatMap((link) =>
      link.ingredients ? [asLocalizedField(link.ingredients.name)] : [],
    ),
    previouslyApproved: row.approved_by !== null,
  }));
}

/** How many products are waiting — for the dashboard and the queue heading. */
export async function countComplianceQueue(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review')
    .is('deleted_at', null);

  if (error) {
    logger.error('countComplianceQueue failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}
