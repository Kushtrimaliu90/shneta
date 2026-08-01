import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { SettingsTabs } from '@/features/settings/components/settings-tabs';

/**
 * docs/06 §15 — the settings suite.
 *
 * The capability is checked once, here, rather than in each of the four pages. A layout guard is
 * enough for *rendering*; every mutation re-checks in its own action, because a server action is
 * reachable by POST without the page that hosts it ever being loaded.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!can(profile?.role, 'settings.manage')) redirect('/admin');

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-semibold text-forest-900">Settings</h1>
      <p className="mt-1 text-sm text-ink-600">
        Configuration that changes the shop. Everything here is audited —{' '}
        <Link
          href="/admin/settings/audit"
          className="text-forest-800 underline underline-offset-4"
        >
          see the log
        </Link>
        .
      </p>

      <SettingsTabs />

      <div className="mt-6">{children}</div>
    </div>
  );
}
