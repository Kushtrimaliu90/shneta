import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resolveLocale } from '@/i18n/locale';
import { Navbar } from '@/components/storefront/navbar';
import { Footer } from '@/components/storefront/footer';
import { WishlistProvider } from '@/features/wishlist/components/wishlist-provider';
import { CompareProvider } from '@/features/compare/components/compare-provider';
import { CompareBar } from '@/features/compare/components/compare-bar';
import { CookieConsent } from '@/features/content/components/cookie-consent';
import { AnnouncementBarView } from '@/features/hero/components/announcement-bar';
import { getAnnouncement } from '@/features/hero/queries';

/**
 * Storefront chrome (docs/05 §17). `main` carries the landmark and the skip-link target
 * (docs/04 §10); the skip link itself is the first focusable element on the page.
 *
 * The wishlist and compare providers sit here rather than on each page, because the controls
 * they serve live on product cards — and cards appear on the shop grid, the PDP, search results,
 * the home page and the wishlist itself. Mounting them per page is how one of those ends up with
 * a heart that silently does nothing.
 *
 * Neither provider reads anything request-scoped from here. `WishlistProvider` fetches its own
 * state after mount, deliberately: a `cookies()` call in a layout opts **every page beneath it**
 * into dynamic rendering, which would quietly end static generation for the whole catalogue.
 * See the note in `wishlist-provider.tsx`.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('common');

  /*
   * Read here rather than inside the bar so the layout stays a server component with no
   * request-scoped input: `getAnnouncement` is a cached, anonymous read, exactly like the catalogue
   * queries. Whether *this* visitor has dismissed it is decided client-side before first paint —
   * see the note in `announcement-bar.tsx` for why that cannot be a `cookies()` call here.
   */
  const announcement = await getAnnouncement();

  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>
      <WishlistProvider>
        <CompareProvider>
          <AnnouncementBarView announcement={announcement} locale={locale} />
          <Navbar />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />

          {/*
            One fixed stack for everything pinned to the bottom, rather than each bar fixing
            itself.

            The compare bar and the cookie banner were independently `fixed inset-x-0 bottom-0`,
            so the banner sat on top of the bar and swallowed its clicks — for every first-time
            visitor, which is to say everyone the compare feature is aimed at (docs/13 §N8).
            Stacked in a column, the newest concern (consent) is closest to the edge and the
            other rows push up above it.

            `pointer-events-none` on the container with `auto` on the rows, so the empty space
            beside a short bar is not an invisible pane over the page.
          */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col [&>*]:pointer-events-auto">
            {/*
              A slot for pages that need their own pinned bar — currently the BioHack result
              page's total-and-actions footer, which portals into it.

              It exists because that bar first fixed itself at `z-30` and reproduced §N8 exactly:
              the consent banner sat on top of it and swallowed the clicks on "Shto gjithçka në
              shportë", on mobile, for every first-time visitor. Two elements pinned to the same
              edge always end that way. Joining the stack is the fix the stack was built for.

              Empty it contributes no height, so every other page is unaffected.
            */}
            <div id="bottom-stack-slot" />
            <CompareBar />
            <CookieConsent />
          </div>
        </CompareProvider>
      </WishlistProvider>
    </>
  );
}
