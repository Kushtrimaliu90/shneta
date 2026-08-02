'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { loadCartItemCount } from '@/features/cart/actions';
import { CART_CHANGED_EVENT } from '@/features/cart/cart-events';

/**
 * The navbar cart link, with its count fetched **after mount**.
 *
 * This is the fix for docs/13 §M1, and it is worth stating what it buys. The count comes from a
 * cookie, `Navbar` is rendered by the storefront layout, and a request-scoped API in a layout
 * opts every page beneath it into dynamic rendering. So reading the cart here — one line, in one
 * component — was why `/`, `/shop`, every category, brand, goal, ingredient and product page had
 * been server-rendered on every request since M4, while the build output cheerfully said `SSG`.
 *
 * Moving the read to the client makes the shell a static file again. The badge is the only thing
 * that arrives late, and it is the only thing on the page that is per-visitor.
 *
 * **The count is deliberately absent from the label until it loads.** The alternative — rendering
 * "0 items" and correcting it a moment later — tells a screen-reader user something false, and
 * tells a sighted user their cart is empty when it is not.
 */
export function CartBadge() {
  const t = useTranslations('common');
  const [count, setCount] = useState<number | null>(null);
  /*
   * Two triggers, because they cover different things. The event catches a mutation on the page
   * you are already on; the pathname catches arriving somewhere new — including a full page load
   * after checkout, where the cart is now empty and the badge must not still say 3.
   */
  const pathname = usePathname();

  useEffect(() => {
    let active = true;

    const refresh = () => {
      void loadCartItemCount().then((next) => {
        if (active) setCount(next);
      });
    };

    refresh();

    /*
     * Server actions still call `revalidatePath('/', 'layout')`, which re-renders the server tree
     * — but this component's state does not come from that render, so it would keep showing the
     * old number. The event is what closes that gap.
     */
    window.addEventListener(CART_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener(CART_CHANGED_EVENT, refresh);
    };
  }, [pathname]);

  const label =
    count === null ? t('cart') : `${t('cart')}, ${t('cartItems', { count })}`;

  return (
    <Link
      href="/cart"
      aria-label={label}
      className="relative inline-flex size-11 items-center justify-center rounded-md text-forest-800 transition-colors hover:bg-forest-50"
    >
      <ShoppingBag className="size-5" aria-hidden="true" />
      {count !== null && count > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1 min-w-4 rounded-full bg-lime-500 px-1 text-[10px] leading-4 font-semibold text-lime-950"
          data-numeric
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
