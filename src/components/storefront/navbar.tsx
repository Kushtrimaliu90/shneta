import { getTranslations } from 'next-intl/server';
import { Search, ShoppingBag, User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { BrandMark } from '@/components/storefront/brand-mark';
import { MobileNav } from '@/components/storefront/mobile-nav';
import { PRIMARY_NAV } from '@/components/storefront/nav-links';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';

/**
 * docs/04 §6 — cream, hairline bottom border, sticky; logo left, nav centre, actions right.
 *
 * M0 renders the static shell. The mega menu, the command-style search overlay and the live
 * cart count arrive with M3/M4; the markup below is the surface they attach to.
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
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <LocaleSwitcher className="mr-1 hidden sm:flex" />

          <Link
            href="/search"
            aria-label={t('common.search')}
            className="inline-flex size-11 items-center justify-center rounded-md text-forest-800 transition-colors hover:bg-forest-50"
          >
            <Search className="size-5" aria-hidden="true" />
          </Link>

          <Link
            href="/account"
            aria-label={t('common.account')}
            className="hidden size-11 items-center justify-center rounded-md text-forest-800 transition-colors hover:bg-forest-50 sm:inline-flex"
          >
            <User className="size-5" aria-hidden="true" />
          </Link>

          <Link
            href="/cart"
            aria-label={t('common.cart')}
            className="relative inline-flex size-11 items-center justify-center rounded-md text-forest-800 transition-colors hover:bg-forest-50"
          >
            <ShoppingBag className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
