import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import type { Locale } from '@/lib/constants';
import { announcementParts } from '@/features/hero/announcement-parts';
import type { AnnouncementBar as Announcement } from '@/features/hero/types';
import { AnnouncementDismiss } from '@/features/hero/components/announcement-dismiss';
import { cn } from '@/lib/utils';

/**
 * The dismissible announcement bar above the navbar.
 *
 * ── Why the dismissal is checked by an inline script ──
 *
 * The storefront layout is **statically rendered** and must stay that way. `navbar.tsx` carries the
 * warning in full: one `cookies()` call in the header opts every catalogue page out of static
 * rendering, which is what happened between M4 and M11 (docs/13 §M1). So the server cannot know
 * whether this visitor has dismissed the bar — the HTML is one document shared by everyone.
 *
 * That leaves three options and only one of them is good:
 *
 *   · Read the cookie in a `useEffect` — correct, but every returning visitor watches the bar appear
 *     and then vanish, and it shifts the page while it does.
 *   · Make the layout dynamic — undoes the milestone that made it static.
 *   · **Check the cookie in a blocking inline script, before first paint.** The same technique a
 *     theme toggle uses to avoid a flash of the wrong colours. The bar is in the HTML, the script
 *     runs the moment the element is parsed, and a visitor who dismissed it never sees a frame with
 *     it in. The CSP already allows inline script (`script-src 'self' 'unsafe-inline'`, see
 *     `next.config.ts` for why that is not avoidable here).
 *
 * The cookie stores the **banner id**, not a boolean. Dismissing the January sale must not silently
 * suppress the February one, and a boolean cannot tell them apart.
 */
export const ANNOUNCEMENT_COOKIE = 'biocode_announcement';

/**
 * The pill outline, shared by the anchor and the plain-text branches so the two are indistinguishable
 * until you hover one.
 */
const PILL =
  'rounded-sm border border-cream/30 px-2 py-0.5 font-ui text-xs font-semibold tracking-wide';

/**
 * A 44 px tap target on a pill that is nowhere near 44 px tall.
 *
 * Growing the pill to meet the floor would make the bar taller on every device to fix a problem that
 * only exists on a touchscreen. A pseudo-element centred on the pill claims the height without
 * occupying any: `before` is positioned, so it contributes nothing to layout, and the parent's
 * `min-h-11` (44 px) already guarantees the row has the room for it to expand into.
 *
 * `focus-visible` is spelled out rather than left to the global rule in `globals.css`, which paints a
 * three-layer halo tuned for a cream page. On forest-900 the outer layer disappears.
 */
const TAP =
  'relative rounded-sm before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[""] focus-visible:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400';

export async function AnnouncementBarView({
  announcement,
  locale,
}: {
  announcement: Announcement | null;
  locale: Locale;
}) {
  if (!announcement) return null;

  const parts = announcementParts(announcement, locale);
  if (!parts) return null;

  const { message, label, href, messageIsLink, pillIsLink } = parts;
  const t = await getTranslations('home.announcement');

  const elementId = `announcement-${announcement.id}`;

  return (
    <>
      <div
        id={elementId}
        className="border-b border-forest-800 bg-forest-900 text-cream"
        data-announcement-id={announcement.id}
      >
        <div className="container-page flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-sm">
          {/*
            The message is the link only when there is no label to carry it. A bar with both would
            otherwise offer two anchors to the same URL, which a screen reader reads out twice.
          */}
          {messageIsLink && href ? (
            <Link href={href} className={cn(TAP, 'underline underline-offset-4 hover:text-white')}>
              {message}
            </Link>
          ) : (
            <span className="min-w-0">{message}</span>
          )}

          {/*
            The pill. Same outline either way — what changes is whether it is an anchor.

            An empty label renders nothing at all: an outlined box with no text inside is a rendering
            bug that looks like a design, and there is no state in which it helps a shopper.
          */}
          {label &&
            (pillIsLink && href ? (
              <Link
                href={href}
                className={cn(PILL, TAP, 'hover:border-cream/60 hover:bg-cream/10')}
              >
                {label}
              </Link>
            ) : (
              <span className={PILL}>{label}</span>
            ))}

          <AnnouncementDismiss
            announcementId={announcement.id}
            elementId={elementId}
            label={t('dismiss')}
          />
        </div>
      </div>

      {/*
        Runs as the parser reaches it, before the bar has been painted. `hidden` rather than a class
        so it cannot be overridden by a stylesheet that loads later, and the whole thing is wrapped in
        a try/catch because a cookie parse must never be able to break the page it sits at the top of.

        It now decides **two** things: whether this visitor dismissed the bar, and whether the campaign
        is inside its window. The second used to be a `starts_at <= now()` filter in the cached query —
        which made that cache valid only for the instant it ran, so it was set to 60 seconds, and because
        the read happens in the shared storefront layout those 60 seconds became the cache life of all 174
        prerendered pages. The tiers set on 8 Aug were dead on arrival because of it.

        Moving the comparison here decouples the page cache from the clock entirely: the HTML can be a day
        old and the bar still disappears the minute the campaign ends, because the browser does the
        comparison against its own clock on every load.

        The honest cost: with JavaScript disabled an expired bar stays visible. That is a promotional
        banner shown late to a visitor who has scripting off, against every page on the site rebuilding
        every minute. Worth it, and worth writing down.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var e=document.getElementById(${JSON.stringify(elementId)});if(!e){return;}var s=${JSON.stringify(
            announcement.startsAt ?? null,
          )},x=${JSON.stringify(
            announcement.endsAt ?? null,
          )},n=Date.now();if((s&&n<Date.parse(s))||(x&&n>=Date.parse(x))){e.hidden=true;return;}var m=document.cookie.match(/(?:^|;\\s*)${ANNOUNCEMENT_COOKIE}=([^;]*)/);if(m&&decodeURIComponent(m[1])===${JSON.stringify(
            announcement.id,
          )}){e.hidden=true;}}catch(_){}})();`,
        }}
      />
    </>
  );
}
