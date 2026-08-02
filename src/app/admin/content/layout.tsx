import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { ContentTabs } from '@/features/content/components/content-tabs';

/**
 * docs/06 §13 — the content section.
 *
 * The capability is checked once here for rendering; every action re-checks it, because a server
 * action is reachable by POST without this layout ever running.
 */
export default async function ContentLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!can(profile?.role, 'content.manage')) redirect('/admin');

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Content</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Everything the shop says that is not a product. Albanian is required; English is optional
        and falls back to Albanian when it is missing.
      </p>

      <ContentTabs />

      <div className="mt-6">{children}</div>
    </div>
  );
}
