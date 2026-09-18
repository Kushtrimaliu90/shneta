import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { createPublicClient } from '@/lib/supabase/public';
import { asLocalizedField, type LocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';

/**
 * Live sponsored placements for a listing page (docs/02 §7).
 *
 * The public client, cached under `placements`, so the shop grid does not pay a query per visitor.
 * The **schedule is enforced in SQL** — `list_live_placements` filters on approval and the date
 * window — rather than here, so an expired placement cannot reappear because a second caller
 * forgot the date clause.
 */

export interface Placement {
  id: string;
  headline: LocalizedField;
  subhead: LocalizedField;
  ctaLabel: LocalizedField;
  destinationUrl: string;
  openInNewTab: boolean;
  imageDesktopPath: string | null;
  imageDesktopAlt: LocalizedField;
  imageMobilePath: string | null;
  imageMobileAlt: LocalizedField;
  /** Paid placements carry the Sponsored label and cannot opt out of it. */
  isPaid: boolean;
}

const fetchPlacements = cache(
  async (categorySlug: string | null, brandSlug: string | null): Promise<Placement[]> => {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc('list_live_placements', {
      p_category_slug: categorySlug ?? undefined,
      p_brand_slug: brandSlug ?? undefined,
    });

    if (error) {
      logger.error('list_live_placements failed', { cause: error.message });
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
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
    }));
  },
);

export const listPlacements = cache(
  async (
    target: { categorySlug?: string | null; brandSlug?: string | null } = {},
  ): Promise<Placement[]> => {
    const category = target.categorySlug ?? null;
    const brand = target.brandSlug ?? null;

    return unstable_cache(
      () => fetchPlacements(category, brand),
      ['placements', category ?? '-', brand ?? '-'],
      {
        tags: [CACHE_TAGS.placements],
        /*
         * One hour, not five minutes (owner cost report, 2026-09-18). Five minutes repeated the
         * docs/13 §AH mistake at one remove: a route's ISR life is the SHORTEST cache used while
         * rendering it, and this slot renders on every PLP lander — so the newly prerendered
         * /shop, category, brand and goal pages were all dragged from their 3600s tier down to
         * 300s, twelve scheduled rebuilds an hour across ~100 routes for a slot that changes by
         * admin action. Those actions purge `CACHE_TAGS.placements` the moment a campaign is
         * approved, paused or ended, so the timer only covers a scheduled start or stop nobody
         * touched by hand — and "went live within the hour" is what a daily-billed campaign's
         * 09:00 start actually needs; the admin can always purge by saving the campaign.
         */
        revalidate: 3600,
      },
    )();
  },
);
