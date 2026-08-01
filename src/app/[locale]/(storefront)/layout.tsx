import { getTranslations, setRequestLocale } from 'next-intl/server';
import { resolveLocale } from '@/i18n/locale';
import { Navbar } from '@/components/storefront/navbar';
import { Footer } from '@/components/storefront/footer';
import { WishlistProvider } from '@/features/wishlist/components/wishlist-provider';
import { CompareProvider } from '@/features/compare/components/compare-provider';
import { CompareBar } from '@/features/compare/components/compare-bar';

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
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('common');

  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipToContent')}
      </a>
      <WishlistProvider>
        <CompareProvider>
          <Navbar />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <CompareBar />
        </CompareProvider>
      </WishlistProvider>
    </>
  );
}
