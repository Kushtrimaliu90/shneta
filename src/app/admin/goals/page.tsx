import type { Metadata } from 'next';
import { TaxonomyScreen } from '@/features/catalog/components/taxonomy-screen';

export const metadata: Metadata = { title: 'Health goals' };

/** docs/06 §7 — health goals. Content managers own these, not product managers. */
export default function AdminGoalsPage() {
  return <TaxonomyScreen kind="goal" capability="content.manage" />;
}
