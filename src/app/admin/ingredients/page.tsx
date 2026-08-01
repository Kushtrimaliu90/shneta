import type { Metadata } from 'next';
import { TaxonomyScreen } from '@/features/catalog/components/taxonomy-screen';

export const metadata: Metadata = { title: 'Ingredients' };

/** docs/06 §6 — the ingredient encyclopaedia. */
export default function AdminIngredientsPage() {
  return <TaxonomyScreen kind="ingredient" capability="catalog.manage" />;
}
