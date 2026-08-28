import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { listAdminPlacements, listPlacementDays } from '@/features/placements/admin-queries';
import { PlacementsAdmin } from '@/features/placements/components/placements-admin';

export const metadata: Metadata = { title: 'Sponsored slots' };

type Props = { searchParams: Promise<{ from?: string; to?: string }> };

/** `YYYY-MM-DD`, or the fallback. A date in a query string is user input like any other. */
function isoDate(value: string | undefined, fallback: Date): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value).valueOf())) {
    return value;
  }
  return fallback.toISOString().slice(0, 10);
}

/**
 * docs/06 — the sponsored placements console.
 *
 * `placements.manage` is a content capability. The judgement an advertiser's creative needs is the
 * health-claim review in docs/08 §7, which is the content manager's job — and approving a paid banner
 * is emphatically not something a merchant should be able to do for themselves.
 */
export default async function AdminPlacementsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'placements.manage')) redirect('/admin');

  const params = await searchParams;
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
  const range = { from: isoDate(params.from, monthAgo), to: isoDate(params.to, today) };

  const [placements, days] = await Promise.all([
    listAdminPlacements(),
    listPlacementDays(range.from, range.to),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Sponsored slots</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-600">
        The banner between the title and the grid on the shop and category pages. Nothing runs until
        it is approved, every paid placement carries a Sponsored label that cannot be switched off,
        and none of it touches product ranking — paid placement buys the banner, not the grid.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-ink-600">
        Impressions count once per placement per page view, and only when the slot is actually in
        the viewport. Counts are aggregated by day with nothing recorded about who saw them.
      </p>

      <PlacementsAdmin placements={placements} days={days} range={range} />
    </div>
  );
}
