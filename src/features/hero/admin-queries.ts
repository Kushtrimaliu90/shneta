import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField } from '@/lib/i18n';
import type { LocalizedField } from '@/lib/i18n';
import type { HeroSettings, TrustItem } from '@/features/hero/types';

/**
 * Reads for `/admin/hero`.
 *
 * The **server** client, so the caller's own session decides what comes back. `hero_slides` has a
 * public read policy scoped to published-and-in-window; a staff session sees drafts and scheduled
 * rows through the same policy's second branch. Using the public client here would show an operator
 * only the slides a shopper can see, which is the opposite of a management screen.
 */

export interface AdminHeroSlide {
  id: string;
  eyebrow: LocalizedField;
  headline: LocalizedField;
  subhead: LocalizedField;
  ctaPrimaryLabel: LocalizedField;
  ctaPrimaryHref: string | null;
  ctaSecondaryLabel: LocalizedField;
  ctaSecondaryHref: string | null;
  imageDesktopPath: string | null;
  imageDesktopAlt: LocalizedField;
  imageMobilePath: string | null;
  imageMobileAlt: LocalizedField;
  textVariant: 'light' | 'dark';
  isPinned: boolean;
  position: number;
  status: 'draft' | 'published';
  startAt: string | null;
  endAt: string | null;
  /** Whether a *published* slide is currently outside its window — the panel says so explicitly. */
  scheduledOut: boolean;
}

export interface AdminAnnouncement {
  id: string;
  title: LocalizedField;
  linkLabel: string | null;
  href: string | null;
  isActive: boolean;
}

export async function listAdminHeroSlides(): Promise<AdminHeroSlide[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('hero_slides')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('admin hero slides failed', { cause: error.message });
    return [];
  }

  const now = Date.now();

  return (data ?? []).map((row) => {
    const startAt = row.starts_at as string | null;
    const endAt = row.ends_at as string | null;

    return {
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
      status: row.status === 'published' ? 'published' : 'draft',
      startAt,
      endAt,
      /*
       * "Published but not showing" is the state an operator will otherwise report as a bug. Worked
       * out here so the list can label it, rather than leaving them to compare two timestamps against
       * the clock in their head.
       */
      scheduledOut:
        row.status === 'published' &&
        ((startAt !== null && new Date(startAt).valueOf() > now) ||
          (endAt !== null && new Date(endAt).valueOf() <= now)),
    };
  });
}

export async function getAdminHeroSettings(): Promise<HeroSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from('settings').select('value').eq('key', 'hero').maybeSingle();
  const raw = ((data as { value: Record<string, unknown> } | null)?.value ?? {}) as Record<
    string,
    unknown
  >;

  return {
    autoplay: raw.autoplay !== false,
    intervalSeconds: Math.min(15, Math.max(3, Number(raw.interval_seconds ?? 6) || 6)),
    transition: raw.transition === 'slide' ? 'slide' : 'fade',
    loop: raw.loop !== false,
    shuffle: raw.shuffle === true,
  };
}

export async function getAdminTrustItems(): Promise<TrustItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'trust_strip')
    .maybeSingle();

  const items = (data as { value: { items?: unknown } } | null)?.value?.items;
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      icon: String(item.icon ?? 'badge'),
      sq: String(item.sq ?? ''),
      en: String(item.en ?? ''),
    }));
}

export async function getAdminAnnouncement(): Promise<AdminAnnouncement | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('banners')
    .select('id, title, link_label, cta_href, is_active')
    .eq('placement', 'announcement')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    title: asLocalizedField(data.title),
    linkLabel: data.link_label,
    href: data.cta_href,
    isActive: data.is_active,
  };
}
