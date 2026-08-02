import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { fontVariables } from '@/lib/fonts';
import { getProfile } from '@/features/auth/queries';
import { isStaff, roleLabel, visibleNav } from '@/features/admin/roles';
import { AdminSidebar } from '@/features/admin/components/admin-sidebar';
import { AdminTopbar } from '@/features/admin/components/admin-topbar';
import '@/styles/globals.css';

/**
 * docs/02 §8 — the admin layout guard.
 *
 * Second of three gates. The middleware proved someone is signed in; this proves they are
 * staff; each action re-checks its own capability; RLS backs all three. None of them is
 * redundant: middleware cannot read `profiles` cheaply, a layout cannot protect a server
 * action reachable by POST without rendering, and both are application code that RLS does
 * not trust.
 *
 * Non-staff are sent to the storefront root rather than shown a "forbidden" page. A customer
 * who mistypes `/admin` learns nothing about whether the path exists, and there is nothing
 * useful for them to do on such a page anyway.
 */

export const metadata: Metadata = {
  title: { default: 'BIOCODE Admin', template: '%s · BIOCODE Admin' },
  // Belt and braces with robots.txt: the panel must never be indexed, and a header on the
  // route is not something a misconfigured `NEXT_PUBLIC_SITE_URL` can undo.
  robots: { index: false, follow: false, nocache: true },
};

/** docs/02 §5 — admin is dynamic and never cached. Staff read live operational state. */
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  if (!profile || !isStaff(profile.role)) redirect('/');

  const sections = visibleNav(profile.role);

  return (
    /*
     * This layout renders `<html>` and `<body>` because it IS a root layout. There is no
     * `src/app/layout.tsx`: the storefront's root lives at `app/[locale]/layout.tsx`, since
     * every storefront route is localized, so `/admin` is a second, independent root
     * (docs/02 §4). Omitting them here rendered every admin page as the global error page.
     *
     * `lang="en"` unconditionally — the admin UI is English-only in v1 (docs/01 §3), which is
     * also why there is no next-intl provider and the strings below are literals. `check:i18n`
     * does not look at this tree.
     */
    <html lang="en" className={fontVariables}>
      <body className="antialiased">
        <div className="min-h-dvh bg-cream lg:grid lg:grid-cols-[15rem_1fr]">
          <AdminSidebar sections={sections} />

          <div className="flex min-w-0 flex-col">
            <AdminTopbar
              name={profile.fullName || profile.email}
              email={profile.email}
              role={roleLabel(profile.role)}
              sections={sections}
            />

            <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
