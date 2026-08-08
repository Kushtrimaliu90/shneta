import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';

/**
 * Reads for `/admin/placements`.
 *
 * The **server** client throughout. `ad_placements` has no public select policy at all — the
 * storefront goes through a security-definer RPC that returns creative and nothing else — so
 * targeting, weights, advertiser names and internal notes are only ever visible to a signed-in
 * staff session. That is deliberate: those are the contract, not the advertisement.
 */

export interface AdminPlacement {
  id: string;
  advertiserName: string;
  internalNote: string | null;
  headline: LocalizedField;
  subhead: LocalizedField;
  ctaLabel: LocalizedField;
  destinationUrl: string;
  openInNewTab: boolean;
  imageDesktopPath: string | null;
  imageDesktopAlt: LocalizedField;
  imageMobilePath: string | null;
  imageMobileAlt: LocalizedField;
  isPaid: boolean;
  status: 'draft' | 'pending_review' | 'approved';
  targetCategorySlugs: string[];
  targetBrandSlugs: string[];
  weight: number;
  startAt: string | null;
  endAt: string | null;
  impressions: number;
  clicks: number;
  /** Approved, but outside its window — the state an operator will otherwise report as a bug. */
  scheduledOut: boolean;
}

export async function listAdminPlacements(): Promise<AdminPlacement[]> {
  const supabase = await createClient();

  const [placements, report] = await Promise.all([
    supabase
      .from('ad_placements')
      .select('*')
      .order('status', { ascending: true })
      .order('weight', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase.from('ad_placement_report').select('id, impressions, clicks'),
  ]);

  if (placements.error) {
    logger.error('admin placements failed', { cause: placements.error.message });
    return [];
  }

  const totals = new Map<string, { impressions: number; clicks: number }>();
  for (const row of report.data ?? []) {
    totals.set(String(row.id), {
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    });
  }

  const now = Date.now();

  return (placements.data ?? []).map((row) => {
    const startAt = row.starts_at as string | null;
    const endAt = row.ends_at as string | null;
    const counts = totals.get(row.id) ?? { impressions: 0, clicks: 0 };

    return {
      id: row.id,
      advertiserName: row.advertiser_name,
      internalNote: row.internal_note,
      headline: asLocalizedField(row.headline),
      subhead: asLocalizedField(row.subhead),
      ctaLabel: asLocalizedField(row.cta_label),
      destinationUrl: row.destination_url,
      openInNewTab: row.open_in_new_tab,
      imageDesktopPath: row.image_desktop_path,
      imageDesktopAlt: asLocalizedField(row.image_desktop_alt),
      imageMobilePath: row.image_mobile_path,
      imageMobileAlt: asLocalizedField(row.image_mobile_alt),
      isPaid: row.is_paid,
      status: row.status as AdminPlacement['status'],
      targetCategorySlugs: row.target_category_slugs ?? [],
      targetBrandSlugs: row.target_brand_slugs ?? [],
      weight: Number(row.weight ?? 1),
      startAt,
      endAt,
      impressions: counts.impressions,
      clicks: counts.clicks,
      scheduledOut:
        row.status === 'approved' &&
        ((startAt !== null && new Date(startAt).valueOf() > now) ||
          (endAt !== null && new Date(endAt).valueOf() <= now)),
    };
  });
}

export interface PlacementDay {
  placementId: string;
  advertiserName: string;
  day: string;
  impressions: number;
  clicks: number;
}

/**
 * Per-day rows for a date range — the shape the CSV export and the report table both need.
 *
 * Bounded by the range rather than by a row cap: a bill covers a period, and silently truncating the
 * middle of one would produce an invoice that is wrong in a way nobody notices.
 */
export async function listPlacementDays(from: string, to: string): Promise<PlacementDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ad_placement_stats')
    .select('placement_id, day, impressions, clicks, ad_placements(advertiser_name)')
    .gte('day', from)
    .lte('day', to)
    .order('day', { ascending: false });

  if (error) {
    logger.error('placement days failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => {
    const parent = row.ad_placements as { advertiser_name?: string } | null;
    return {
      placementId: row.placement_id,
      advertiserName: parent?.advertiser_name ?? '—',
      day: row.day,
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    };
  });
}
