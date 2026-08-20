'use client';

import { X } from 'lucide-react';
import { ANNOUNCEMENT_COOKIE } from '@/features/hero/components/announcement-bar';

/**
 * The close button, and the only piece of the announcement bar that needs JavaScript at runtime.
 *
 * ── A cookie, not localStorage ──
 *
 * Written with `document.cookie` rather than through a server action, because a server action would
 * be a round trip to dismiss a bar and the storefront layout deliberately never reads cookies on the
 * server (see the note in `announcement-bar.tsx`). The *storage medium* is a cookie exactly as
 * specified; only the read and the write are client-side, which is what keeps the homepage static.
 *
 * `SameSite=Lax` and a one-year life. Not `Secure`, because localhost is http and a dismissal is not
 * a secret; not `HttpOnly`, because the inline script that prevents the flash has to be able to read
 * it. Both are the correct trade for a cookie whose entire contents is "this person closed a banner".
 */
export function AnnouncementDismiss({
  announcementId,
  elementId,
  label,
}: {
  announcementId: string;
  elementId: string;
  label: string;
}) {
  function dismiss() {
    const year = 60 * 60 * 24 * 365;
    document.cookie = `${ANNOUNCEMENT_COOKIE}=${encodeURIComponent(announcementId)}; path=/; max-age=${year}; SameSite=Lax`;

    // Hidden directly rather than through state: the bar is server-rendered and this component owns
    // only the button, so there is no React tree above it to re-render.
    const element = document.getElementById(elementId);
    if (element) element.hidden = true;
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      aria-label={label}
      /*
        docs/04 §10 puts the hit-area floor at 44px. This measured 24 x 24 — which clears WCAG 2.5.8
        (AA) at exactly its 24px minimum and is why axe never flagged it, but it is half the size this
        project asked for, on the one control that makes an unwanted bar go away.
        `size-11` with a `-m-2.5` pull-back so the target grows without moving the glyph or adding
        height to the bar, which is inside the hero's fold budget.
      */
      className="-m-2.5 ml-0.5 inline-flex size-11 items-center justify-center rounded-sm text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}
