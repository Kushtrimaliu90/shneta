import { getTranslations } from 'next-intl/server';
import { User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { BrandMark } from '@/components/storefront/brand-mark';
import { MobileNav } from '@/components/storefront/mobile-nav';
import { PRIMARY_NAV } from '@/components/storefront/nav-links';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { CartBadge } from '@/features/cart/components/cart-badge';
import { HeaderSearch } from '@/features/search/components/header-search';
import { getSearchPlaceholders } from '@/features/search/queries';
import { getLocale } from 'next-intl/server';
import type { Locale } from '@/lib/constants';

/**
 * docs/04 §6 — cream, hairline bottom border, sticky; logo left, nav centre, actions right.
 *
 * The header reads **nothing request-scoped**. That is deliberate and load-bearing: this
 * component is rendered by the storefront layout, so one `cookies()` call here opts every
 * catalogue page beneath it out of static rendering — which is exactly what happened between M4
 * and M11 (docs/13 §M1). The cart count is per-visitor, so it lives in `CartBadge`, which
 * fetches it after mount. The search field's recent-searches cookie is read the same way, on the
 * client, for the same reason.
 *
 * ── Search is inline, not behind a magnifier ──
 *
 * On a marketplace, search is primary navigation. It occupies roughly a third of the header on
 * desktop and its own full-width row on a phone, where it is always visible rather than one tap
 * away. The nav links drop out at `lg` before the field does — if something has to give at a
 * middle width it is the links, which are duplicated in the mobile sheet and the footer, not the
 * field, which is duplicated nowhere.
 */
export async function Navbar() {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const placeholders = await getSearchPlaceholders(locale);

  /*
   * ── No `backdrop-blur` on this header, and that is correctness rather than taste ──
   *
   * `backdrop-filter` makes an element a **containing block for `position: fixed` descendants** — the
   * same rule `transform` and `filter` follow. Both overlays mounted here are `fixed inset-0`, so with a
   * blur on the header they resolved against the header's own box instead of the viewport. Measured on a
   * 390 px phone: the mobile menu's panel came out **390 × 64**, so tapping the hamburger opened a
   * 64-pixel strip with the page showing through beneath it. The search overlay had the same defect.
   *
   * Removing it cost nothing: at 95% opacity the blur behind it was very nearly invisible, and
   * docs/04 §6 asks for "cream, hairline bottom border, sticky", not frosted glass. A portal would
   * also have fixed it, but removing the trap beats working around it.
   *
   * **The background is now fully opaque, which is the other half of that fix.** The 95% existed to
   * let the blur show through; with the blur gone it was translucency with nothing behind it — and on
   * the two-row mobile header the page scrolled visibly *through* the chrome, with product names
   * ghosting behind the wordmark on every screen. That reads as a rendering fault rather than a
   * style, which is exactly how it was reported.
   *
   * Anything added here later that establishes a containing block — `transform`, `filter`,
   * `perspective`, `will-change`, `contain: paint` — breaks both overlays the same way and in a way that
   * looks like a z-index problem. `e2e/shell.spec.ts` asserts the panel fills the viewport, so it fails
   * rather than ships.
   */
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream">
      <div className="container-page flex h-14 items-center gap-3 lg:h-20 lg:gap-4">
        <MobileNav />

        <Link href="/" className="shrink-0 rounded-sm" aria-label={t('common.brand')}>
          <BrandMark />
        </Link>

        <nav aria-label={t('nav.primary')} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {PRIMARY_NAV.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="inline-flex h-11 items-center rounded-md px-3 text-[15px] font-medium text-ink-900 transition-colors hover:bg-forest-50 hover:text-forest-800"
                >
                  {t(`nav.${link.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/*
          The field takes the slack between the nav and the actions. `max-w-md` keeps it from
          sprawling on a wide monitor; `flex-1` is what gives it real presence at 1280.
        */}
        <div className="ml-auto hidden min-w-0 flex-1 justify-end lg:flex">
          <HeaderSearch placeholders={placeholders} className="w-full max-w-md" />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-2">
          <LocaleSwitcher className="mr-1 hidden sm:flex" />

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

      {/*
        Its own row below the logo on a phone, always visible.

        Not behind a tap-to-expand icon, which is the arrangement this replaces: on a catalogue of
        ninety products the field is how people navigate, and hiding it behind an affordance costs a
        tap on every single search. It costs about 56 px of vertical space, which is why the hero was
        re-measured at 393 × 852 after this landed rather than before.
      */}
      <div className="container-page pb-2 lg:hidden">
        <HeaderSearch placeholders={placeholders} />
      </div>
    </header>
  );
}
