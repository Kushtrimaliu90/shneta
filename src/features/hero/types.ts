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
  code: string | null;
  href: string | null;
}
