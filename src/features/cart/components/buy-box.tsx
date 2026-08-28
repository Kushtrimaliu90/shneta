'use client';

import { useActionState, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { ShoppingBag } from 'lucide-react';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { notifyCartChanged } from '@/features/cart/cart-events';
import { PriceTag } from '@/components/storefront/price-tag';
import { SellerLine } from '@/components/storefront/seller-line';
import { SubmitButton } from '@/components/ui/submit-button';
import { addToCartAction, type CartResult } from '@/features/cart/actions';
import { SubscribeToggle } from '@/features/subscriptions/components/subscribe-toggle';
import type { ProductVariantDetail } from '@/features/catalog/types';

/**
 * The purchase form's DOM id — what lets the sticky mobile bar's button submit it from outside
 * the form element (`form` attribute), and what the IntersectionObserver looks up. One BuyBox
 * per page (the PDP), so a fixed id is safe.
 */
const BUY_FORM_ID = 'buy-box-form';

/**
 * docs/05 §3 — the PDP purchase panel: price, variant choice, stock line, add to cart.
 *
 * These four belong to one component because they are one decision. Splitting the variant
 * picker from the price is what produced the M3 shortfall this replaces: the PDP could only
 * ever add the *default* variant, which left six of thirty seeded SKUs — the 240-count D3,
 * the 634 g creatine, the vanilla whey among them — impossible to buy at all.
 *
 * It is a single real `<form>`, and that is the whole trick:
 *   · without JavaScript the radios still post, so any variant is purchasable before
 *     hydration — the picker is not decoration layered on top of a fixed hidden field.
 *   · with JavaScript the price and stock line follow the selection instantly, with no
 *     request, because every variant's price and stock already arrived with the page.
 *   · the page therefore stays statically renderable (docs/02 §5). Encoding the selection
 *     in `?variant=` would have read `searchParams` and made every PDP dynamic — losing ISR
 *     on the most-visited route type to save a few lines of state.
 *
 * The server action re-reads the price from `product_variants` regardless of what is posted
 * (docs/07 §3), so a forged `variantId` buys that variant at its real price, never at one
 * chosen by the client.
 */
export function BuyBox({
  variants,
  productName,
  subscriptionDiscountPct = 0,
}: {
  variants: ProductVariantDetail[];
  /** Names the sticky bar's submit apart from the form's own — see `MobileBuyBar`. */
  productName: string;
  /** docs/07 §8.1 — 0 hides the subscribe option entirely, which is the off switch. */
  subscriptionDiscountPct?: number;
}) {
  /*
   * The server-action reference, not a client closure around `addToCart`: only a reference gets
   * the progressive-enhancement wiring into the server HTML, and "without JavaScript the radios
   * still post" (above) is only true with it. See `addToCartAction`'s comment.
   */
  const [state, formAction] = useActionState<CartResult | null, FormData>(addToCartAction, null);

  // Tells the navbar badge to refetch — see `CartBadge` and docs/13 §M1.
  useEffect(() => {
    if (state?.ok) notifyCartChanged();
  }, [state]);
  const t = useTranslations();
  const locale = useLocale() as Locale;

  /*
   * docs/05 §3 — the sticky mobile buy bar shows only while the real purchase form is off
   * screen. Observed by id rather than by ref because `ActionForm` owns its form element;
   * `true` until the observer reports, so the bar cannot flash over a form that is on screen
   * at load.
   */
  const [formVisible, setFormVisible] = useState(true);
  useEffect(() => {
    const form = document.getElementById(BUY_FORM_ID);
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => {
      setFormVisible(entry ? entry.isIntersecting : true);
    });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  /*
   * The bar also stands down while the site footer is on screen. The footer's last row — the
   * legal links and the copyright line — sits inside the bar's ~65px, and the document reserves
   * no scroll space for a fixed overlay, so at maximum scroll those links could NEVER be
   * scrolled clear of it: a permanent tap-and-focus shadow over interactive content (WCAG
   * 2.4.11 territory). A shopper reading the footer is not mid-purchase; the bar returns the
   * moment they scroll back up. `false` until the observer reports: the footer starts
   * off-screen on any page tall enough to show the bar at all.
   */
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    /* The storefront layout renders exactly one <footer> landmark. */
    const footer = document.querySelector('footer');
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => {
      setFooterVisible(entry ? entry.isIntersecting : false);
    });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  /*
   * Opening selection: the default variant, unless it is out of stock and something else is
   * not. Landing on an unbuyable option when a buyable one exists is a dead end the
   * customer has to diagnose — `on-gold-standard-whey` is exactly that shape.
   */
  const preferred =
    variants.find((variant) => variant.isDefault && variant.stockStatus !== 'out_of_stock') ??
    variants.find((variant) => variant.stockStatus !== 'out_of_stock') ??
    variants.find((variant) => variant.isDefault) ??
    variants[0];

  const [selectedId, setSelectedId] = useState(preferred?.id ?? '');
  const selected = variants.find((variant) => variant.id === selectedId) ?? preferred;

  if (!selected) return null;

  const soldOut = selected.stockStatus === 'out_of_stock';

  return (
    <ActionForm id={BUY_FORM_ID} action={formAction} state={state} className="flex flex-col gap-6">
      <div>
        <PriceTag
          priceCents={selected.priceCents}
          compareAtPriceCents={selected.compareAtPriceCents}
          size="lg"
        />
        {/* docs/05 §3 — the VAT-inclusive note sits with the price, not in the footer. */}
        <p className="mt-1 text-sm text-ink-500">{t('product.vatIncluded')}</p>
      </div>

      {variants.length > 1 ? (
        /*
         * A real radio group, so arrow keys move between options and the group is announced
         * as one control. `<fieldset>`/`<legend>` gives it its name without any ARIA.
         */
        <fieldset>
          <legend className="eyebrow">{t('product.options')}</legend>
          <ul className="mt-3 flex flex-wrap gap-2">
            {variants.map((option) => {
              const unavailable = option.stockStatus === 'out_of_stock';
              const active = option.id === selected.id;

              return (
                <li key={option.id}>
                  <label
                    htmlFor={`variant-${option.id}`}
                    className={[
                      'inline-flex min-h-11 cursor-pointer items-center rounded-sm border px-3.5 text-sm transition-colors',
                      // docs/04 §10 — the focus ring has to be visible on the label, since
                      // the radio itself is visually hidden.
                      'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest-700',
                      unavailable
                        ? 'cursor-not-allowed border-dashed border-line-strong text-ink-500 line-through'
                        : active
                          ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                          : 'border-line-strong text-ink-900 hover:bg-forest-50',
                    ].join(' ')}
                  >
                    <input
                      id={`variant-${option.id}`}
                      type="radio"
                      name="variantId"
                      value={option.id}
                      checked={active}
                      disabled={unavailable}
                      onChange={() => setSelectedId(option.id)}
                      className="sr-only"
                    />
                    {pickLocale(option.name, locale) || option.sku}
                    {unavailable && (
                      <span className="sr-only"> — {t('product.outOfStockLine')}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        <input type="hidden" name="variantId" value={selected.id} />
      )}

      <input type="hidden" name="quantity" value={1} />

      {/* docs/07 §8.1 — the subscribe intent rides along on the same add-to-cart submission. */}
      {subscriptionDiscountPct > 0 && !soldOut && (
        <SubscribeToggle discountPct={subscriptionDiscountPct} />
      )}

      {/* Stock line (docs/05 §3) — follows the selection. */}
      <p className="text-sm" role="status">
        {soldOut ? (
          <span className="text-ink-600">{t('product.outOfStockLine')}</span>
        ) : selected.stockStatus === 'low' ? (
          <span className="font-medium text-warning">{t('product.lowStockLine')}</span>
        ) : (
          <span className="font-medium text-success">{t('product.inStockLine')}</span>
        )}
      </p>

      {/* docs/16 §1 — who the customer is buying from, on the panel where they decide to. */}
      {!soldOut && <SellerLine supply={selected.supply} />}

      <div className="flex flex-col gap-3">
        <SubmitButton size="lg" block disabled={soldOut} loadingLabel={t('cart.adding')}>
          <ShoppingBag className="size-5" aria-hidden="true" />
          {soldOut ? t('product.outOfStockLine') : t('cart.addToCart')}
        </SubmitButton>

        {state?.ok && (
          // aria-live so the confirmation is announced, not just seen (docs/04 §10).
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            {t('cart.added')}
          </p>
        )}
        {state && !state.ok && <Alert tone="error">{t(state.error)}</Alert>}
      </div>

      {/*
        Inside the ActionForm on purpose, even though its DOM lands in the layout's bottom
        stack: `useFormStatus` in the bar's SubmitButton reads the form's status through the
        React tree, and a portal keeps that tree while moving the DOM.
      */}
      <MobileBuyBar
        show={!formVisible && !footerVisible && !soldOut}
        variant={selected}
        productName={productName}
      />
    </ActionForm>
  );
}

/**
 * docs/05 §3 — the sticky mobile bar: selected-variant price plus the add-to-cart action,
 * pinned to the bottom edge while the purchase form is scrolled away.
 *
 * It is **the same form**, not a second one: the button carries `form={BUY_FORM_ID}`, so the
 * browser submits the real purchase form with whatever variant and subscribe choice is selected
 * up there — no duplicated action wiring, and `useFormStatus` disables both buttons during the
 * one round trip.
 *
 * Rendered into the layout's `#bottom-stack-slot` rather than fixing itself — two elements
 * pinned to the same edge always end with one swallowing the other's clicks (docs/13 §N8), and
 * the stack exists so the consent banner and this bar negotiate by stacking. Same pattern as
 * `protocol-actions.tsx`. Opaque surface, not translucent: a pinned bar cannot promise AA
 * contrast against a background it does not control (docs/13 §T5).
 *
 * Enter/exit is a translate inside `motion-safe` — `starting:translate-y-full` slides it in on
 * mount, the `show` flag slides it out, and unmount trails by a timer slightly past
 * `--duration-ui` so the exit is visible without leaving a hidden bar holding stack height.
 */
function MobileBuyBar({
  show,
  variant,
  productName,
}: {
  show: boolean;
  variant: ProductVariantDetail;
  productName: string;
}) {
  const t = useTranslations();

  /** The layout's bottom stack. Resolved after mount, like `protocol-actions.tsx`. */
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('bottom-stack-slot')), []);

  /*
   * A timer rather than `transitionend`: under `prefers-reduced-motion` the transition never
   * runs, so waiting on its end event would leave the translated-away bar mounted forever —
   * invisible, but still intercepting taps meant for the consent banner beneath it.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(timer);
  }, [show]);

  if (!slot || !mounted) return null;

  return createPortal(
    <div
      className={cn(
        'border-t border-line bg-surface shadow-lg lg:hidden',
        'motion-safe:transition-transform motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)]',
        'motion-safe:starting:translate-y-full',
        /*
          While sliding out, the bar hangs translated over whatever sits under it in the
          bottom stack — `pointer-events-none` keeps those 300ms from eating a tap meant
          for the consent banner.
        */
        show ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <PriceTag
          priceCents={variant.priceCents}
          compareAtPriceCents={variant.compareAtPriceCents}
        />
        {/*
          The named label keeps this button's accessible name distinct from the form's own
          "Add to cart" submit — the two are briefly in the tree together, and an unscoped
          getByRole('button', { name: 'Add to cart' }) (seven e2e call sites) must keep
          resolving to exactly one element. Same treatment quick-add.tsx gives its buttons.
        */}
        <SubmitButton
          form={BUY_FORM_ID}
          loadingLabel={t('cart.adding')}
          aria-label={t('cart.addToCartNamed', { name: productName })}
        >
          <ShoppingBag className="size-5" aria-hidden="true" />
          {t('cart.addToCart')}
        </SubmitButton>
      </div>
    </div>,
    slot,
  );
}
