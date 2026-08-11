import type { LocalizedField } from '@/lib/i18n';

/** A hero slide, narrowed for rendering. jsonb is already through `asLocalizedField`. */
export interface HeroSlide {
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
  /** Falls back to the desktop crop when empty. */
  imageMobilePath: string | null;
  imageMobileAlt: LocalizedField;
  /**
   * Which way the slide reads.
   *
   * `dark` is dark text on the cream ground — the editorial default, and what the brand slide uses.
   * `light` is cream text on forest-950, for a promo that wants to shout without changing the type.
   * It is a legibility control, not a theme: the admin picks whichever the slide's photograph sits
   * against better.
   */
  textVariant: 'light' | 'dark';
  isPinned: boolean;
  position: number;
}

export interface HeroSettings {
  autoplay: boolean;
  /** Clamped to 3–15 on read, so a bad settings row cannot produce a 0 ms interval. */
  intervalSeconds: number;
  transition: 'fade' | 'slide';
  loop: boolean;
  shuffle: boolean;
}

export interface TrustItem {
  icon: string;
  sq: string;
  en: string;
}

export interface AnnouncementBar {
  id: string;
  title: LocalizedField;
  /** Text on the clickable pill. Was `code` until migration 77 — see that file for why. */
  linkLabel: string | null;
  href: string | null;
  /**
   * The scheduled window, carried to the browser rather than applied in the query.
   *
   * Filtering by `now()` inside a cached read forces that cache to be short — 60 seconds, which capped
   * every page on the site (see `getAnnouncement`). The window travels with the bar instead and the
   * pre-paint script decides, so the page can be cached for a day and still not show a finished campaign.
   */
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * One homepage entry tile (migration 81). Copy, destination and icon are all content now.
 */
export interface IntentTile {
  icon: string;
  href: string;
  title: LocalizedField;
  body: LocalizedField;
}
