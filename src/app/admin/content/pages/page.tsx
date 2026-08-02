import type { Metadata } from 'next';
import { PagesEditor } from '@/features/content/components/simple-editors';
import { listAdminPages } from '@/features/content/admin-queries';

export const metadata: Metadata = { title: 'Pages' };

/** docs/06 §13 — the fixed pages. */
export default async function AdminPagesPage() {
  const pages = await listAdminPages();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-carbon-900">Pages</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        Four pages the shop links to by name. They cannot be added or removed here — a fifth page
        would need a route, which is a code change.
      </p>
      <PagesEditor pages={pages} />
    </section>
  );
}
