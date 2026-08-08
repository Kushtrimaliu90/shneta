import { NextResponse, type NextRequest } from 'next/server';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { listPlacementDays } from '@/features/placements/admin-queries';

/**
 * The billing export: one row per placement per day, for a date range.
 *
 * ── A route, not a client-side blob ──
 *
 * The CSV comes from the same query the report table renders, so the file and the screen cannot
 * disagree — which matters when the file is what an invoice is written from. Building it in the
 * browser from data already on the page would work until somebody paginated the table.
 *
 * Guarded by the same capability as the console. The route is separate from the page, so the check
 * has to be repeated here; RLS on `ad_placement_stats` is the backstop under both.
 */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!can(profile?.role, 'placements.manage')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const valid = (value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(value).valueOf())
      ? value
      : null;

  const today = new Date().toISOString().slice(0, 10);
  const from = valid(params.get('from')) ?? today;
  const to = valid(params.get('to')) ?? today;

  const rows = await listPlacementDays(from, to);

  /**
   * Quoted, with internal quotes doubled — an advertiser name may legitimately contain a comma.
   *
   * The leading apostrophe guard is for a name beginning with `=`, `+`, `-` or `@`: a spreadsheet
   * reads those as a formula, which is CSV injection and is a real way to attack the person who
   * opens the invoice, not the site.
   */
  const cell = (value: string | number): string => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const csv = [
    ['day', 'placement_id', 'advertiser', 'impressions', 'clicks', 'ctr_pct'].join(','),
    ...rows.map((row) =>
      [
        cell(row.day),
        cell(row.placementId),
        cell(row.advertiserName),
        cell(row.impressions),
        cell(row.clicks),
        cell(row.impressions > 0 ? ((row.clicks / row.impressions) * 100).toFixed(2) : '0.00'),
      ].join(','),
    ),
  ].join('\r\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="placements-${from}-to-${to}.csv"`,
      // Never cached: it is a report about money, read by one person, and a stale copy is a wrong bill.
      'Cache-Control': 'no-store',
    },
  });
}
