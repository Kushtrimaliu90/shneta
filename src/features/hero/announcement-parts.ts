import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import type { AnnouncementBar } from '@/features/hero/types';

/**
 * What the announcement bar renders, decided before any JSX exists.
 *
 * The bar has four shapes depending on which of the two author fields are filled, and picking between
 * them inside an `async` server component made the matrix untestable — proving the label-only case
 * would have meant writing to the live `banners` row that is on screen right now. Pure input in, plain
 * object out, so the four cases are five lines of Vitest instead.
 *
 * `linkLabel` was called `code` and sat beside a **hardcoded** "Shop now" link (`home.announcement.cta`).
 * The live row is the bug in one line: `cta_href = /merchant/apply`, `code = "BioPartner"`, rendering
 * "Bli tani". The author had already written the right label into a column nothing displayed.
 */
export interface AnnouncementParts {
  message: string;
  /** Non-null only when there is text to put in the pill. Never an empty outline. */
  label: string | null;
  href: string | null;
  /** The message carries the link itself, because there is no pill to carry it. */
  messageIsLink: boolean;
  /** The pill is an anchor rather than plain text. */
  pillIsLink: boolean;
}

export function announcementParts(
  announcement: Pick<AnnouncementBar, 'title' | 'linkLabel' | 'href'>,
  locale: Locale,
): AnnouncementParts | null {
  const message = pickLocale(announcement.title, locale).trim();
  // No message is no bar. A pill on its own is an orphan with no sentence to belong to.
  if (!message) return null;

  /*
   * Trimmed here rather than trusted from the column. The admin action trims on save, but a `banners`
   * row is reachable from psql, and `' '` is truthy — it would render an outlined pill containing a
   * space, which looks like a design rather than the bug it is.
   */
  const label = announcement.linkLabel?.trim() || null;
  const href = announcement.href?.trim() || null;

  return {
    message,
    label,
    href,
    /*
     * Only when there is no label to carry the link. With both, the bar would offer two anchors to one
     * URL — a screen reader announces the destination twice and a keyboard user tabs through it twice.
     */
    messageIsLink: Boolean(href) && !label,
    pillIsLink: Boolean(href) && Boolean(label),
  };
}
