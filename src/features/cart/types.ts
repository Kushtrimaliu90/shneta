import type { LocalizedField } from '@/lib/i18n';
import type { Totals } from '@/lib/money';
import type { StockStatus } from '@/features/catalog/types';

/** A cart line, resolved against the live catalog and priced from the DB. */
export interface CartLine {
  id: string;
  variantId: string;
  quantity: number;
  productSlug: string;
  productName: LocalizedField;
  variantName: LocalizedField;
  sku: string;
  unitPriceCents: number;
  compareAtPriceCents: number | null;
  imagePath: string | null;
  stockStatus: StockStatus;
  /** Live stock ceiling for the quantity stepper, capped at the per-line maximum. */
  maxQuantity: number;
}

export interface ShippingMethodOption {
  id: string;
  name: LocalizedField;
  description: LocalizedField;
  priceCents: number;
  freeOverCents: number | null;
  minDays: number;
  maxDays: number;
}

export interface AppliedCoupon {
  code: string;
  type: 'percentage' | 'fixed' | 'free_shipping';
  value: number;
  minSubtotalCents: number | null;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  /**
   * Lines dropped on read because the variant went inactive or the product was
   * unpublished (docs/07 §3.2). Surfaced so the UI can say what disappeared rather than
   * silently shrinking the cart.
   */
  prunedSkus: string[];
  itemCount: number;
  subtotalCents: number;
  /** Cheapest active method's threshold — drives the free-shipping progress bar. */
  freeShippingThresholdCents: number | null;
}

export interface CartSummary extends Totals {
  itemCount: number;
}

/**
 * Coded errors the cart and checkout actions can return, as i18n message keys so the
 * compiler checks them (the pattern from features/auth).
 */
export type CartErrorKey =
  | 'cart.errors.variantUnavailable'
  | 'cart.errors.outOfStock'
  | 'cart.errors.maxQuantity'
  | 'cart.errors.notFound'
  | 'cart.errors.empty'
  | 'cart.errors.generic';

export type CheckoutErrorKey =
  | 'checkout.errors.cartEmpty'
  | 'checkout.errors.cartNotFound'
  | 'checkout.errors.itemUnavailable'
  | 'checkout.errors.outOfStock'
  | 'checkout.errors.couponInvalid'
  | 'checkout.errors.couponMinNotMet'
  | 'checkout.errors.couponExhausted'
  | 'checkout.errors.couponAlreadyUsed'
  | 'checkout.errors.shippingMethodInvalid'
  | 'checkout.errors.providerUnavailable'
  | 'checkout.errors.checkFields'
  | 'checkout.errors.tooManyAttempts'
  | 'checkout.errors.generic';

/**
 * docs/07 §4.5 — the RPC raises coded errors like `OUT_OF_STOCK:<sku>`. This maps them to
 * message keys, so a Postgres exception becomes a sentence a customer can act on rather
 * than a leaked internal string.
 */
export function mapCheckoutError(message: string): {
  key: CheckoutErrorKey;
  sku?: string;
} {
  const [code, detail] = message.split(':');

  switch (code?.trim()) {
    case 'CART_EMPTY':
      return { key: 'checkout.errors.cartEmpty' };
    case 'CART_NOT_FOUND':
      return { key: 'checkout.errors.cartNotFound' };
    case 'CART_ITEM_UNAVAILABLE':
      return { key: 'checkout.errors.itemUnavailable', sku: detail?.trim() };
    case 'OUT_OF_STOCK':
      return { key: 'checkout.errors.outOfStock', sku: detail?.trim() };
    case 'COUPON_INVALID':
      return { key: 'checkout.errors.couponInvalid' };
    case 'COUPON_MIN_NOT_MET':
      return { key: 'checkout.errors.couponMinNotMet' };
    case 'COUPON_EXHAUSTED':
      return { key: 'checkout.errors.couponExhausted' };
    case 'COUPON_ALREADY_USED':
      return { key: 'checkout.errors.couponAlreadyUsed' };
    case 'SHIPPING_METHOD_INVALID':
      return { key: 'checkout.errors.shippingMethodInvalid' };
    case 'PROVIDER_UNAVAILABLE':
      return { key: 'checkout.errors.providerUnavailable' };
    default:
      return { key: 'checkout.errors.generic' };
  }
}
