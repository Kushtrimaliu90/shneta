'use client';

import { useActionState, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ShoppingBag } from 'lucide-react';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { notifyCartChanged } from '@/features/cart/cart-events';
import { PriceTag } from '@/components/storefront/price-tag';
import { SellerLine } from '@/components/storefront/seller-line';
import { SubmitButton } from '@/components/ui/submit-button';
import { addToCart, type CartResult } from '@/features/cart/actions';
import { SubscribeToggle } from '@/features/subscriptions/components/subscribe-toggle';
import type { ProductVariantDetail } from '@/features/catalog/types';

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
  subscriptionDiscountPct = 0,
}: {
  variants: ProductVariantDetail[];
  /** docs/07 §8.1 — 0 hides the subscribe option entirely, which is the off switch. */
  subscriptionDiscountPct?: number;
}) {
  const [state, formAction] = useActionState<CartResult | null, FormData>(
    async (_previous, formData) => addToCart(formData),
    null,
  );

  // Tells the navbar badge to refetch — see `CartBadge` and docs/13 §M1.
  useEffect(() => {
    if (state?.ok) notifyCartChanged();
  }, [state]);
  const t = useTranslations();
  const locale = useLocale() as Locale;

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
    <ActionForm action={formAction} state={state} className="flex flex-col gap-6">
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
          <legend className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
            {t('product.options')}
          </legend>
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
    </ActionForm>
  );
}
