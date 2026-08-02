import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { TeamAdmin } from '@/features/settings/components/team-admin';
import { listTeam } from '@/features/settings/queries';

export const metadata: Metadata = { title: 'Team' };

/** docs/06 §15 — staff accounts. */
export default async function AdminTeamPage() {
  const profile = await getProfile();
  // The layout guard has already turned away a non-admin; this narrows the type for the id below.
  if (!profile) redirect('/admin');

  const members = await listTeam();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-forest-900">Team</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        Who can sign into the panel, and what each of them can reach. Roles come from the permission
        matrix in docs/01 §3 — a role is a set of screens, not a job title.
      </p>
      <TeamAdmin members={members} currentUserId={profile.id} />
    </section>
  );
}
