import type { Metadata } from 'next';
import { TaxonomyScreen } from '@/features/catalog/components/taxonomy-screen';

export const metadata: Metadata = { title: 'Brands' };

/** docs/06 §5 — brands. */
export default function AdminBrandsPage() {
  return <TaxonomyScreen kind="brand" capability="catalog.manage" />;
}
