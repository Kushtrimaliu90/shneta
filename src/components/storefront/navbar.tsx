import { getTranslations } from 'next-intl/server';
import { User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { BrandMark } from '@/components/storefront/brand-mark';
import { MobileNav } from '@/components/storefront/mobile-nav';
import { PRIMARY_NAV } from '@/components/storefront/nav-links';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { CartBadge } from '@/features/cart/components/cart-badge';
import { SearchOverlay } from '@/features/search/components/search-overlay';

/**
 * docs/04 §6 — cream, hairline bottom border, sticky; logo left, nav centre, actions right.
 *
 * The header reads **nothing request-scoped**. That is deliberate and load-bearing: this
 * component is rendered by the storefront layout, so one `cookies()` call here opts every
 * catalogue page beneath it out of static rendering — which is exactly what happened between M4
 * and M11 (docs/13 §M1). The cart count is per-visitor, so it lives in `CartBadge`, which
 * fetches it after mount.
 */
export async function Navbar() {
  const t = await getTranslations();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/95 backdrop-blur-sm">
      <div className="container-page flex h-16 items-center gap-4 lg:h-20">
        <MobileNav />

        <Link href="/" className="rounded-sm" aria-label={t('common.brand')}>
          <BrandMark />
        </Link>

        <nav aria-label={t('nav.primary')} className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-md px-3.5 text-[15px] font-medium text-ink-900 transition-colors hover:bg-forest-50 hover:text-forest-800"
                >
                  {t(`nav.${link.key}`)}
                </Link>
              </li>
            ))}
            {/*
              BioHack sits outside `PRIMARY_NAV` and is styled apart from it.
              `PRIMARY_NAV` is the catalogue taxonomy — the footer renders the same list under
              "Shop" — and the generator is not a category. It is the one link here that starts
              something rather than listing something, which is also why it carries the accent.
            */}
            <li>
              <Link
                href="/biohack"
                className="ml-1 inline-flex h-11 items-center rounded-md border border-lime-500/60 bg-lime-500/10 px-3.5 text-[15px] font-semibold text-forest-800 transition-colors hover:bg-lime-500/20"
              >
                {t('nav.biohack')}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <LocaleSwitcher className="mr-1 hidden sm:flex" />

          {/* docs/05 §8 — the magnifier opens the instant overlay rather than navigating. */}
          <SearchOverlay />

          <Link
            href="/account"
            aria-label={t('common.account')}
            className="hidden size-11 items-center justify-center rounded-md text-forest-800 transition-colors hover:bg-forest-50 sm:inline-flex"
          >
            <User className="size-5" aria-hidden="true" />
          </Link>

          {/*
            docs/05 §17 — the count is part of the accessible label, so a screen-reader user
            hears "Cart, 2 items in cart" rather than "Cart" plus a number they cannot reach.
            It arrives after mount; see the note above.
          */}
          <CartBadge />

        </div>
      </div>
    </header>
  );
}
