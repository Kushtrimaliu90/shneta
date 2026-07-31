import 'server-only';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import { ORDER_ACCESS_COOKIE_NAME } from '@/lib/constants';

/**
 * docs/13 §B1 — reading an order without a session.
 *
 * Order numbers are human-readable and partly sequential, so they are an identifier, not a
 * secret. The success page therefore requires the `access_token` minted by the checkout RPC
 * and stored in a short-lived httpOnly cookie — never passed in the URL, where it would end
 * up in history, in a shared link, and in any analytics referrer.
 *
 * Guest order lookup takes the other route: order number **plus** the email it was placed
 * with, rate-limited, returning a deliberately generic not-found (docs/05 §13).
 *
 * The service client is used because there is no session for a guest order — sanctioned by
 * docs/02 §6 (guest order lookup).
 */

/**
 * The `order_status` enum from docs/03 §1. Narrowed on read so `t('order.status.' + status)`
 * typechecks and an unexpected value renders as `pending` rather than a raw message key.
 */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

function toOrderStatus(value: string): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : 'pending';
}

export interface OrderView {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  email: string;
  placedAt: string;
  locale: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  couponCode: string | null;
  shippingAddress: Record<string, string | null>;
  shippingMethodName: ReturnType<typeof asLocalizedField>;
  minDays: number | null;
  maxDays: number | null;
  items: {
    name: string;
    sku: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
}

const ORDER_SELECT = `order_number, status, payment_status, email, placed_at, locale,
  subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, coupon_code,
  shipping_address, shipping_method,
  order_items ( name_snapshot, sku, quantity, unit_price_cents, total_cents )`;

interface RawOrder {
  order_number: string;
  status: string;
  payment_status: string;
  email: string;
  placed_at: string;
  locale: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  coupon_code: string | null;
  shipping_address: Record<string, string | null>;
  shipping_method: { name?: unknown; min_days?: number; max_days?: number } | null;
  order_items: {
    name_snapshot: string;
    sku: string;
    quantity: number;
    unit_price_cents: number;
    total_cents: number;
  }[];
}

function toView(raw: RawOrder): OrderView {
  return {
    orderNumber: raw.order_number,
    status: toOrderStatus(raw.status),
    paymentStatus: raw.payment_status,
    email: raw.email,
    placedAt: raw.placed_at,
    locale: raw.locale,
    subtotalCents: raw.subtotal_cents,
    discountCents: raw.discount_cents,
    shippingCents: raw.shipping_cents,
    taxCents: raw.tax_cents,
    totalCents: raw.total_cents,
    couponCode: raw.coupon_code,
    shippingAddress: raw.shipping_address,
    shippingMethodName: asLocalizedField(raw.shipping_method?.name),
    minDays: raw.shipping_method?.min_days ?? null,
    maxDays: raw.shipping_method?.max_days ?? null,
    items: raw.order_items.map((item) => ({
      name: item.name_snapshot,
      sku: item.sku,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      totalCents: item.total_cents,
    })),
  };
}

/**
 * Reads the order the caller just placed, proved by the access cookie.
 *
 * The token is compared against the stored one for **that specific order number**, so a
 * cookie from an earlier order cannot open a different one.
 */
export async function getOrderByAccessCookie(orderNumber: string): Promise<OrderView | null> {
  const store = await cookies();
  const raw = store.get(ORDER_ACCESS_COOKIE_NAME)?.value;
  if (!raw) return null;

  const separator = raw.indexOf(':');
  if (separator === -1) return null;

  const cookieOrderNumber = raw.slice(0, separator);
  const token = raw.slice(separator + 1);
  if (cookieOrderNumber !== orderNumber || token.length < 32) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('orders')
    .select(ORDER_SELECT)
    .eq('order_number', orderNumber)
    .eq('access_token', token)
    .maybeSingle();

  if (error) {
    logger.error('Order access lookup failed', { cause: error.message });
    return null;
  }
  return data ? toView(data as unknown as RawOrder) : null;
}

/**
 * docs/05 §13 — verifies an order-number/email pair and returns the access token for it.
 *
 * Returns only the token, not the order: the caller sets the access cookie and redirects to
 * the server-rendered page, which then reads the order through
 * `getOrderByAccessCookie`. That keeps one authorisation path rather than two.
 *
 * Null for any mismatch, without distinguishing "no such order" from "wrong email", so the
 * form cannot be used to test whether an order number exists.
 */
export async function getOrderAccessToken(
  orderNumber: string,
  email: string,
): Promise<{ orderNumber: string; accessToken: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('orders')
    .select('order_number, access_token')
    .eq('order_number', orderNumber.trim())
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    logger.error('Order lookup failed', { cause: error.message });
    return null;
  }

  const row = data as { order_number: string; access_token: string } | null;
  return row ? { orderNumber: row.order_number, accessToken: row.access_token } : null;
}
