import type { Metadata } from 'next';
import { BannersEditor } from '@/features/content/components/simple-editors';
import { listAdminBanners } from '@/features/content/admin-queries';

export const metadata: Metadata = { title: 'Banners' };

/** docs/06 §13 — promotional banners, per placement. */
export default async function AdminBannersPage() {
  const banners = await listAdminBanners();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-carbon-900">Banners</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        A banner shows only while it is active and inside its dates. Leaving the dates empty means
        &ldquo;always&rdquo;.
      </p>
      <BannersEditor banners={banners} />
    </section>
  );
}
