import type { Metadata } from 'next';
import { TaxonomyScreen } from '@/features/catalog/components/taxonomy-screen';

export const metadata: Metadata = { title: 'Categories' };

/** docs/06 §4 — categories. */
export default function AdminCategoriesPage() {
  return <TaxonomyScreen kind="category" capability="catalog.manage" />;
}
