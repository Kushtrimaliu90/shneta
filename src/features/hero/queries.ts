import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS, STATIC_REVALIDATE_SECONDS } from '@/lib/constants';
import { createPublicClient } from '@/lib/supabase/public';
import { asLocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import type {
  AnnouncementBar,
  HeroSettings,
  HeroSlide,
  TrustItem,
} from '@/features/hero/types';

/**
 * Hero reads (docs/02 §7). All on the **public** client, all cached under `hero`.
 *
 * The homepage is static with a 300 s ISR window, so these run at build or revalidation rather than
 * per visitor. The admin purges `hero` on save, which is what makes an edit appear without a deploy.
 *
 * RLS does the scheduling. The `p_read` policy on `hero_slides` returns only published slides inside
 * their window, so a slide dated for next Monday is invisible to the anonymous role on Sunday —
 * there is no `where` clause here that a second caller could forget.
 */

const DEFAULT_SETTINGS: HeroSettings = {
  autoplay: true,
  intervalSeconds: 6,
  transition: 'fade',
  loop: true,
  shuffle: false,
};

const fetchSlides = cache(async (): Promise<HeroSlide[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('hero_slides')
    .select(
      `id, eyebrow, headline, subhead, cta_primary_label, cta_primary_href,
       cta_secondary_label, cta_secondary_href, image_desktop_path, image_desktop_alt,
       image_mobile_path, image_mobile_alt, text_variant, is_pinned, position`,
    )
    // Pinned first at the database, so the "which slide is the h1" question is answered before any
    // client code runs and cannot change during hydration.
    .order('is_pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('hero slides failed', { cause: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eyebrow: asLocalizedField(row.eyebrow),
    headline: asLocalizedField(row.headline),
    subhead: asLocalizedField(row.subhead),
    ctaPrimaryLabel: asLocalizedField(row.cta_primary_label),
    ctaPrimaryHref: row.cta_primary_href,
    ctaSecondaryLabel: asLocalizedField(row.cta_secondary_label),
    ctaSecondaryHref: row.cta_secondary_href,
    imageDesktopPath: row.image_desktop_path,
    imageDesktopAlt: asLocalizedField(row.image_desktop_alt),
    imageMobilePath: row.image_mobile_path,
    imageMobileAlt: asLocalizedField(row.image_mobile_alt),
    textVariant: row.text_variant === 'light' ? 'light' : 'dark',
    isPinned: row.is_pinned,
    position: row.position,
  }));
});

export const listHeroSlides = cache(async (): Promise<HeroSlide[]> => {
  return unstable_cache(() => fetchSlides(), ['hero-slides'], {
    tags: [CACHE_TAGS.hero],
    /*
     * Five minutes, not one.
     *
     * Unlike the announcement bar this read is genuinely time-dependent — the RLS policy on
     * `hero_slides` filters `starts_at <= now()` itself — so a longer window really does delay a
     * SCHEDULED slide. What it does not delay is publishing one by hand: the admin purges
     * `CACHE_TAGS.hero` on save, which is immediate.
     *
     * So the number only governs campaigns dated for a future minute, and it applies to the home page
     * alone rather than to the whole site. One minute meant 1,440 rebuilds a day of the most-requested
     * page for a lateness nobody can perceive on a promotional banner; five is a fifth of that and still
     * well inside "went live this morning".
     */
    revalidate: 300,
  })();
});

function readSettings(value: unknown): HeroSettings {
  if (value == null || typeof value !== 'object') return DEFAULT_SETTINGS;
  const raw = value as Record<string, unknown>;

  return {
    autoplay: raw.autoplay !== false,
    /*
     * Clamped on read rather than trusted. The admin form validates 3–15, but a settings row is also
     * reachable from psql, and a zero here would be an infinite loop in a `setInterval` on every
     * visitor's homepage.
     */
    intervalSeconds: Math.min(15, Math.max(3, Number(raw.interval_seconds ?? 6) || 6)),
    transition: raw.transition === 'slide' ? 'slide' : 'fade',
    loop: raw.loop !== false,
    shuffle: raw.shuffle === true,
  };
}

const fetchSettings = cache(async (): Promise<HeroSettings> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'hero')
    .maybeSingle();

  if (error) {
    logger.error('hero settings failed', { cause: error.message });
    return DEFAULT_SETTINGS;
  }
  return readSettings((data as { value: unknown } | null)?.value);
});

export const getHeroSettings = cache(async (): Promise<HeroSettings> => {
  return unstable_cache(() => fetchSettings(), ['hero-settings'], {
    tags: [CACHE_TAGS.hero],
    revalidate: ISR_REVALIDATE_SECONDS,
  })();
});

const fetchTrustItems = cache(async (): Promise<TrustItem[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'trust_strip')
    .maybeSingle();

  if (error) {
    logger.error('trust strip failed', { cause: error.message });
    return [];
  }

  const items = (data as { value: { items?: unknown } } | null)?.value?.items;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      icon: String(item.icon ?? 'check'),
      sq: String(item.sq ?? ''),
      en: String(item.en ?? ''),
    }))
    .filter((item) => item.sq || item.en);
});

export const getTrustItems = cache(async (): Promise<TrustItem[]> => {
  return unstable_cache(() => fetchTrustItems(), ['hero-trust'], {
    tags: [CACHE_TAGS.hero],
    revalidate: ISR_REVALIDATE_SECONDS,
  })();
});

/**
 * The announcement bar, if one is live.
 *
 * A `banners` row at the `announcement` placement rather than a fourth settings key: it already has
 * bilingual copy, an optional link, an on/off and a schedule, and reusing it means one admin screen
 * instead of two that do the same thing.
 *
 * The RLS policy on `banners` does not filter the window, so unlike the slides this one is filtered
 * here — worth stating, because the asymmetry looks like an oversight and is not.
 */
const fetchAnnouncement = cache(async (): Promise<AnnouncementBar | null> => {
  const supabase = createPublicClient();

  /*
   * No `now()` in this query, deliberately.
   *
   * It used to filter `starts_at.lte.now` and `ends_at.gt.now`, which makes the result true only for
   * the instant it was computed — so the cache around it had to be 60 seconds. This read runs in the
   * shared storefront layout, and a route's cache life is the SHORTEST cache used while rendering it, so
   * those 60 seconds became the cache life of all 174 prerendered pages, overriding the day and the hour
   * the tiers declared. Measured in `.next/prerender-manifest.json`; the tiers had been dead since the
   * day they were written.
   *
   * The window now travels to the browser and the bar's own pre-paint script applies it against the
   * visitor's clock. `is_active` stays here because it is not time-dependent: an admin toggling it
   * purges `CACHE_TAGS.banners`, which is immediate.
   */
  const { data, error } = await supabase
    .from('banners')
    .select('id, title, cta_href, link_label, starts_at, ends_at')
    .eq('placement', 'announcement')
    .eq('is_active', true)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) logger.error('announcement bar failed', { cause: error.message });
    return null;
  }

  return {
    id: data.id,
    title: asLocalizedField(data.title),
    linkLabel: data.link_label,
    href: data.cta_href,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
  };
});

export const getAnnouncement = cache(async (): Promise<AnnouncementBar | null> => {
  return unstable_cache(() => fetchAnnouncement(), ['hero-announcement'], {
    tags: [CACHE_TAGS.hero, CACHE_TAGS.banners],
    /*
     * The long tier, now that the read no longer depends on the clock.
     *
     * This one number set the cache life of the whole storefront. It is the layout's only cached read, so
     * anything short here is paid on every page — `tests/unit/build-cache-budget.test.ts` asserts against
     * the compiled manifest so it cannot silently drop again.
     */
    revalidate: STATIC_REVALIDATE_SECONDS,
  })();
});

/**
 * The cheapest active method's free-shipping threshold, in cents.
 *
 * ── Why this is not `getFreeShippingThreshold` from the cart ──
 *
 * That one exists and is correct, and it reads through `createClient()` — the SSR client that touches
 * `cookies()`. Calling it from the homepage would opt the whole page out of static rendering, which
 * is the exact failure `navbar.tsx` documents and M11 spent a milestone undoing. Same query, public
 * client, cached under the shipping tag.
 *
 * Cheapest rather than any: promising free delivery against an express method nobody selects would be
 * a lie, and it is the same rule the cart drawer's progress bar follows (docs/07 §3.2).
 */
const fetchShippingThreshold = cache(async (): Promise<number | null> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from('shipping_methods')
    .select('free_over_cents')
    .eq('is_active', true)
    .not('free_over_cents', 'is', null)
    .order('free_over_cents', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('free shipping threshold failed', { cause: error.message });
    return null;
  }
  return (data as { free_over_cents: number } | null)?.free_over_cents ?? null;
});

export const getFreeShippingThresholdCents = cache(async (): Promise<number | null> => {
  return unstable_cache(() => fetchShippingThreshold(), ['hero-free-shipping'], {
    tags: [CACHE_TAGS.shipping],
    revalidate: ISR_REVALIDATE_SECONDS,
  })();
});
