import { DEFAULT_VAT_RATE_PERCENT, type Locale } from '@/lib/constants';

/**
 * Money is integer cents, EUR (CLAUDE.md §2). Never floats, never string math.
 *
 * The totals algorithm below is the canonical one from docs/07 §2 and is a line-by-line
 * mirror of `checkout_create_order` (docs/03 §8). `tests/unit/money.test.ts` asserts parity;
 * if you change one you must change the other in the same commit.
 */

export type DiscountType = 'percentage' | 'fixed' | 'free_shipping';

export interface CouponLike {
  type: DiscountType;
  /** percentage: whole percent · fixed: cents · free_shipping: ignored */
  value: number;
  minSubtotalCents?: number | null;
}

export interface ShippingMethodLike {
  priceCents: number;
  freeOverCents?: number | null;
}

export interface CartLineLike {
  unitPriceCents: number;
  quantity: number;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  /** Informational only — prices are VAT-inclusive (docs/07 §5). */
  taxCents: number;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const GROUP_SEPARATOR: Record<Locale, string> = { sq: '.', en: ',' };
const DECIMAL_SEPARATOR: Record<Locale, string> = { sq: ',', en: '.' };

/**
 * U+00A0, written as an escape on purpose.
 *
 * The amount and the symbol must never break across a line, and a literal non-breaking
 * space is invisible in a diff — it is exactly the kind of character that silently changes
 * rendered output and survives review. Tests compare against this constant, not a literal.
 */
export const CURRENCY_NBSP = ' ';

/**
 * docs/04 §4 — sq renders `9,90 €`, en renders `€9.90`. Never mix the two.
 *
 * Formatted explicitly rather than through `Intl.NumberFormat` so the output is byte-stable
 * across Node/ICU versions and identical on server and client (no hydration mismatch).
 */
export function formatPrice(cents: number, locale: Locale): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR[locale]);
  const amount = `${grouped}${DECIMAL_SEPARATOR[locale]}${String(fraction).padStart(2, '0')}`;
  const signed = negative ? `-${amount}` : amount;

  return locale === 'sq' ? `${signed}${CURRENCY_NBSP}€` : `€${signed}`;
}

/** Euros as typed by an admin (`"18.50"`, `18.5`) → integer cents. Throws on garbage. */
export function toCents(euros: string | number): number {
  const raw = typeof euros === 'number' ? euros.toFixed(2) : euros.trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new RangeError(`Not a valid euro amount: ${String(euros)}`);
  }
  const negative = raw.startsWith('-');
  const [whole = '0', fraction = ''] = raw.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Integer cents → a plain decimal string suitable for a number input (`1850` → `"18.50"`). */
export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return `${negative ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Totals — must match checkout_create_order exactly
// ---------------------------------------------------------------------------

export function subtotalCents(lines: readonly CartLineLike[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/**
 * docs/07 §2 — percentage floors, fixed clamps to the subtotal, free_shipping discounts
 * nothing (it acts on shipping instead). Mirrors the RPC's integer division.
 */
export function discountCents(subtotal: number, coupon: CouponLike | null | undefined): number {
  if (!coupon) return 0;
  switch (coupon.type) {
    case 'percentage':
      return Math.floor((subtotal * coupon.value) / 100);
    case 'fixed':
      return Math.min(coupon.value, subtotal);
    case 'free_shipping':
      return 0;
  }
}

/** docs/07 §2 — the free-over threshold is tested against `subtotal − discount`. */
export function shippingCents(
  subtotal: number,
  discount: number,
  method: ShippingMethodLike,
  coupon?: CouponLike | null,
): number {
  if (coupon?.type === 'free_shipping') return 0;
  if (method.freeOverCents != null && subtotal - discount >= method.freeOverCents) return 0;
  return method.priceCents;
}

/**
 * VAT broken out of a VAT-inclusive total: `round(total × rate / (100 + rate))`, half-up.
 *
 * Computed with exact integer arithmetic rather than floating point so it cannot drift from
 * Postgres `numeric` at a `.5` boundary. `round(a/b)` half-up == `floor((2a + b) / 2b)`.
 */
export function taxCents(total: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT): number {
  const rateBasisPoints = Math.round(ratePercent * 100);
  const numerator = total * rateBasisPoints;
  const denominator = 10_000 + rateBasisPoints;
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function computeTotals(input: {
  lines: readonly CartLineLike[];
  coupon?: CouponLike | null;
  shippingMethod: ShippingMethodLike;
  vatRatePercent?: number;
}): Totals {
  const subtotal = subtotalCents(input.lines);
  const coupon = eligibleCoupon(subtotal, input.coupon);
  const discount = discountCents(subtotal, coupon);
  const shipping = shippingCents(subtotal, discount, input.shippingMethod, coupon);
  const total = subtotal - discount + shipping;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    totalCents: total,
    taxCents: taxCents(total, input.vatRatePercent),
  };
}

/** A coupon below its minimum subtotal does not apply. The RPC raises `COUPON_MIN_NOT_MET`. */
function eligibleCoupon(subtotal: number, coupon: CouponLike | null | undefined) {
  if (!coupon) return null;
  if (coupon.minSubtotalCents != null && subtotal < coupon.minSubtotalCents) return null;
  return coupon;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** docs/07 §1 — sale badge percentage. Returns null when there is no genuine markdown. */
export function percentOff(
  priceCents: number,
  compareAtCents: number | null | undefined,
): number | null {
  if (compareAtCents == null || compareAtCents <= priceCents || priceCents < 0) return null;
  return Math.round((1 - priceCents / compareAtCents) * 100);
}

/** docs/05 §12 — "Add €X for free delivery". Returns 0 once the threshold is met. */
export function amountToFreeShipping(
  subtotal: number,
  freeOverCents: number | null | undefined,
): number {
  if (freeOverCents == null) return 0;
  return Math.max(0, freeOverCents - subtotal);
}
