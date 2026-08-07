import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import {
  getAdminAnnouncement,
  getAdminHeroSettings,
  getAdminTrustItems,
  listAdminHeroSlides,
} from '@/features/hero/admin-queries';
import { HeroAdmin } from '@/features/hero/components/hero-admin';

export const metadata: Metadata = { title: 'Homepage hero' };

/**
 * docs/06 — the homepage hero console.
 *
 * `hero.manage` is a content capability: everything here is copy, imagery and scheduling, which is
 * the content manager's job rather than the catalogue's. Admin passes unconditionally, as always.
 *
 * Guarded twice, deliberately. This check produces the redirect an operator should see; the RLS
 * policies on `hero_slides` and `settings` are what actually stop a write, and they would hold even
 * if this line were deleted.
 */
export default async function AdminHeroPage() {
  const profile = await getProfile();
  if (!can(profile?.role, 'hero.manage')) redirect('/admin');

  const [slides, settings, trustItems, announcement] = await Promise.all([
    listAdminHeroSlides(),
    getAdminHeroSettings(),
    getAdminTrustItems(),
    getAdminAnnouncement(),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Homepage hero</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-600">
        The carousel, the trust strip beneath it and the announcement bar above the navbar. Saving
        anything here purges the homepage cache, so a change is live on the next page load rather
        than after the next deploy.
      </p>

      <HeroAdmin
        slides={slides}
        settings={settings}
        trustItems={trustItems}
        announcement={announcement}
      />
    </div>
  );
}
