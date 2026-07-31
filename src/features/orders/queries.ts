import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { asLocalizedField } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import {
  toOrderStatus,
  toPaymentStatus,
  type OrderAddress,
  type OrderDetail,
  type OrderListRow,
  type OrderStatus,
  type PaymentStatus,
} from '@/features/orders/types';

/**
 * Order reads for both the admin panel (docs/06 §2) and the customer account (docs/05 §14).
 *
 * All of it through the **SSR client**, so RLS decides what each caller sees. That is the whole
 * design: `getOrder` is one function, and a customer calling it gets their own order with only
 * customer-visible events while support gets any order with the full timeline — because
 * `p_read on order_events` says so, not because this file checks a role.
 *
 * The service client is deliberately absent. It appears in the guest paths (docs/02 §6) because
 * a guest has no session to check against; staff and signed-in customers both do.
 */

/** How many rows a page of the admin list holds. */
export const ORDERS_PAGE_SIZE = 25;

export interface OrderFilters {
  status?: OrderStatus;
  // Typed as the enum, not `string`: the generated DB types narrow `.eq('payment_status', …)`
  // to the enum union, so a loose string here fails to compile at the call site instead of here.
  paymentStatus?: PaymentStatus;
  search?: string;
  from?: string;
  to?: string;
  /** Keyset cursor: the `placed_at` of the last row on the previous page. */
  before?: string;
}

interface RawListRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  email: string;
  total_cents: number;
  placed_at: string;
  shipping_address: OrderAddress;
  order_items: { quantity: number }[];
  payments: { provider: string }[];
}

const LIST_SELECT = `id, order_number, status, payment_status, email, total_cents, placed_at,
  shipping_address, order_items ( quantity ), payments ( provider )`;

/**
 * docs/06 §2 — the admin orders list.
 *
 * **Keyset pagination, not offset.** `placed_at desc` with a `< cursor` predicate stays
 * O(log n) at any depth and, more importantly here, cannot skip or repeat a row when an order
 * is placed mid-browse — which with `offset` it silently does, and an operator working a queue
 * would never notice they missed one.
 *
 * `placed_at` has a millisecond resolution and two orders can share it, so the cursor is
 * strictly `<` and the page size is fetched plus one to detect a next page. The theoretical
 * cost is losing an order that shares the exact boundary timestamp; the alternative is a
 * composite `(placed_at, id)` cursor, which is the right fix if that ever bites. Noted rather
 * than pre-solved.
 */
export async function listOrders(
  filters: OrderFilters,
): Promise<{ rows: OrderListRow[]; nextCursor: string | null }> {
  const supabase = await createClient();

  let query = supabase
    .from('orders')
    .select(LIST_SELECT)
    .order('placed_at', { ascending: false })
    .limit(ORDERS_PAGE_SIZE + 1);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.paymentStatus) query = query.eq('payment_status', filters.paymentStatus);
  if (filters.from) query = query.gte('placed_at', filters.from);
  if (filters.to) query = query.lte('placed_at', filters.to);
  if (filters.before) query = query.lt('placed_at', filters.before);

  if (filters.search) {
    const term = filters.search.trim();
    /*
     * Order number or email. `or()` takes a PostgREST filter string, so the term is stripped
     * of the characters that are syntax in that grammar — a comma would split the expression
     * and a parenthesis would unbalance it. Not an injection risk (PostgREST parameterises the
     * values) but a correctness one: an unescaped comma silently searches for something else.
     */
    const safe = term.replace(/[,()*]/g, ' ').trim();
    if (safe) query = query.or(`order_number.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('listOrders failed', { cause: error.message });
    return { rows: [], nextCursor: null };
  }

  const raw = (data ?? []) as unknown as RawListRow[];
  const page = raw.slice(0, ORDERS_PAGE_SIZE);
  const hasMore = raw.length > ORDERS_PAGE_SIZE;

  return {
    rows: page.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: toOrderStatus(row.status),
      paymentStatus: toPaymentStatus(row.payment_status),
      email: row.email,
      recipientName: row.shipping_address?.recipient_name ?? '',
      city: row.shipping_address?.city ?? '',
      itemCount: row.order_items.reduce((sum, item) => sum + item.quantity, 0),
      totalCents: row.total_cents,
      placedAt: row.placed_at,
      provider: row.payments[0]?.provider ?? null,
    })),
    // `page` holds raw rows, so the cursor is the snake_case column, not the mapped field.
    nextCursor: hasMore ? (page[page.length - 1]?.placed_at ?? null) : null,
  };
}

/** docs/06 §2 — the status tabs are counts, so they have to be real counts. */
export async function countOrdersByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient();

  /*
   * One row per order rather than seven `count` round trips. At the volume a Kosovo launch
   * will see this is cheaper than the requests it replaces; if the table ever outgrows that,
   * `v_admin_daily_sales` or a dedicated view is the answer, not seven queries.
   */
  const { data, error } = await supabase.from('orders').select('status');

  if (error) {
    logger.error('countOrdersByStatus failed', { cause: error.message });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    counts.all = (counts.all ?? 0) + 1;
  }
  return counts;
}

interface RawDetail {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  email: string;
  phone: string;
  user_id: string | null;
  locale: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  coupon_code: string | null;
  customer_note: string | null;
  admin_note: string | null;
  shipping_address: OrderAddress;
  billing_address: OrderAddress;
  shipping_method: { name?: unknown; min_days?: number; max_days?: number } | null;
  placed_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  order_items: {
    id: string;
    name_snapshot: string;
    sku: string;
    image_path: string | null;
    quantity: number;
    unit_price_cents: number;
    total_cents: number;
    variant_id: string | null;
  }[];
  order_events: {
    id: string;
    type: string;
    message: string | null;
    is_customer_visible: boolean;
    created_at: string;
    profiles: { full_name: string | null } | null;
  }[];
  shipments: {
    id: string;
    carrier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    status: string;
    shipped_at: string | null;
  }[];
  refunds: {
    id: string;
    amount_cents: number;
    reason: string;
    restock: boolean;
    created_at: string;
  }[];
  payments: {
    id: string;
    provider: string;
    status: string;
    amount_cents: number;
    provider_ref: string | null;
  }[];
}

const DETAIL_SELECT = `id, order_number, status, payment_status, email, phone, user_id, locale,
  subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, coupon_code,
  customer_note, admin_note, shipping_address, billing_address, shipping_method,
  placed_at, delivered_at, cancelled_at,
  order_items ( id, name_snapshot, sku, image_path, quantity, unit_price_cents, total_cents, variant_id ),
  order_events ( id, type, message, is_customer_visible, created_at, profiles ( full_name ) ),
  shipments ( id, carrier, tracking_number, tracking_url, status, shipped_at ),
  refunds ( id, amount_cents, reason, restock, created_at ),
  payments ( id, provider, status, amount_cents, provider_ref )`;

/**
 * One order, by id.
 *
 * Returns null both when the order does not exist and when the caller may not see it. Not
 * distinguishing the two is the point: a customer probing ids learns nothing, and the caller
 * has one case to handle instead of two that mean the same thing to the UI.
 *
 * Wrapped in `cache()` so a page, its metadata function and a header component share one read.
 */
export const getOrder = cache(async (id: string): Promise<OrderDetail | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('getOrder failed', { cause: error.message });
    return null;
  }
  if (!data) return null;

  const raw = data as unknown as RawDetail;

  return {
    id: raw.id,
    orderNumber: raw.order_number,
    status: toOrderStatus(raw.status),
    paymentStatus: toPaymentStatus(raw.payment_status),
    email: raw.email,
    phone: raw.phone,
    userId: raw.user_id,
    locale: raw.locale,
    subtotalCents: raw.subtotal_cents,
    discountCents: raw.discount_cents,
    shippingCents: raw.shipping_cents,
    taxCents: raw.tax_cents,
    totalCents: raw.total_cents,
    couponCode: raw.coupon_code,
    customerNote: raw.customer_note,
    adminNote: raw.admin_note,
    shippingAddress: raw.shipping_address,
    billingAddress: raw.billing_address,
    shippingMethodName: asLocalizedField(raw.shipping_method?.name),
    minDays: raw.shipping_method?.min_days ?? null,
    maxDays: raw.shipping_method?.max_days ?? null,
    placedAt: raw.placed_at,
    deliveredAt: raw.delivered_at,
    cancelledAt: raw.cancelled_at,
    items: raw.order_items.map((item) => ({
      id: item.id,
      name: item.name_snapshot,
      sku: item.sku,
      imagePath: item.image_path,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      totalCents: item.total_cents,
      variantId: item.variant_id,
    })),
    // Newest last: a timeline reads top-down as the order progressed.
    events: [...raw.order_events]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        isCustomerVisible: event.is_customer_visible,
        createdAt: event.created_at,
        actorName: event.profiles?.full_name ?? null,
      })),
    shipments: raw.shipments.map((shipment) => ({
      id: shipment.id,
      carrier: shipment.carrier,
      trackingNumber: shipment.tracking_number,
      trackingUrl: shipment.tracking_url,
      status: shipment.status,
      shippedAt: shipment.shipped_at,
    })),
    refunds: raw.refunds.map((refund) => ({
      id: refund.id,
      amountCents: refund.amount_cents,
      reason: refund.reason,
      restock: refund.restock,
      createdAt: refund.created_at,
    })),
    payments: raw.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      status: toPaymentStatus(payment.status),
      amountCents: payment.amount_cents,
      providerRef: payment.provider_ref,
    })),
    refundedCents: raw.refunds.reduce((sum, refund) => sum + refund.amount_cents, 0),
  };
});

/**
 * docs/05 §14 — the signed-in customer's own orders.
 *
 * No user filter: `p_read on orders` already restricts this to `user_id = auth.uid()` unless
 * the caller is staff. Adding `.eq('user_id', …)` would be harmless but misleading — it would
 * read as though this function were the protection, and the next person would trust it.
 *
 * Guest orders are not here by construction; they have no `user_id` and are reached through
 * order lookup instead (docs/05 §13).
 */
export const listMyOrders = cache(async (): Promise<OrderListRow[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('orders')
    .select(LIST_SELECT)
    .order('placed_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error('listMyOrders failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawListRow[]).map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    status: toOrderStatus(row.status),
    paymentStatus: toPaymentStatus(row.payment_status),
    email: row.email,
    recipientName: row.shipping_address?.recipient_name ?? '',
    city: row.shipping_address?.city ?? '',
    itemCount: row.order_items.reduce((sum, item) => sum + item.quantity, 0),
    totalCents: row.total_cents,
    placedAt: row.placed_at,
    provider: row.payments[0]?.provider ?? null,
  }));
});

/** The same order by number rather than id — what a customer's URL carries. */
export const getMyOrderByNumber = cache(
  async (orderNumber: string): Promise<OrderDetail | null> => {
    const supabase = await createClient();

    const { data } = await supabase
      .from('orders')
      .select('id')
      .eq('order_number', orderNumber)
      .maybeSingle();

    const row = data as { id: string } | null;
    return row ? getOrder(row.id) : null;
  },
);
