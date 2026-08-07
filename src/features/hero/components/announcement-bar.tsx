import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import type { AnnouncementBar as Announcement } from '@/features/hero/types';
import { AnnouncementDismiss } from '@/features/hero/components/announcement-dismiss';

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

export async function AnnouncementBarView({
  announcement,
  locale,
}: {
  announcement: Announcement | null;
  locale: Locale;
}) {
  if (!announcement) return null;

  const t = await getTranslations('home.announcement');
  const message = pickLocale(announcement.title, locale);
  if (!message) return null;

  const elementId = `announcement-${announcement.id}`;

  return (
    <>
      <div
        id={elementId}
        className="border-b border-forest-800 bg-forest-900 text-cream"
        data-announcement-id={announcement.id}
      >
        <div className="container-page flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-sm">
          <span>{message}</span>

          {announcement.code && (
            <span className="rounded-sm border border-cream/30 px-2 py-0.5 font-ui text-xs font-semibold tracking-wide">
              {announcement.code}
            </span>
          )}

          {announcement.href && (
            <Link
              href={announcement.href}
              className="rounded-sm underline underline-offset-4 hover:text-white"
            >
              {t('cta')}
            </Link>
          )}

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
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${ANNOUNCEMENT_COOKIE}=([^;]*)/);if(m&&decodeURIComponent(m[1])===${JSON.stringify(
            announcement.id,
          )}){var e=document.getElementById(${JSON.stringify(elementId)});if(e){e.hidden=true;}}}catch(_){}})();`,
        }}
      />
    </>
  );
}
