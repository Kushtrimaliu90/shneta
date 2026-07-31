import type { LocalizedField } from '@/lib/i18n';

/**
 * Order shapes shared by the admin panel and the customer account.
 *
 * One module because they read the same rows through different policies, and duplicating the
 * types is how the two drift into disagreeing about what an order is. What differs is *how
 * much* each may see, and RLS decides that — not a second set of interfaces.
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

export const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function toOrderStatus(value: string | null | undefined): OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as OrderStatus)
    : 'pending';
}

export function toPaymentStatus(value: string | null | undefined): PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as PaymentStatus)
    : 'pending';
}

/**
 * docs/07 §7.1 — the transitions the database will accept, mirrored here.
 *
 * The authority is `orders_before_status_change`, which raises
 * `INVALID_STATUS_TRANSITION:from->to`. This copy exists so the UI can **disable** buttons
 * that would fail rather than offering them and reporting an error afterwards — docs/06 §2
 * asks for exactly that. It is a convenience, not a second gate: an action that skipped the
 * check would still be refused by the trigger.
 *
 * `refunded` is absent as a target because it is not a button. It is a consequence of
 * inserting a refund, which is its own flow with its own amount and reason (docs/07 §7.3).
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
};

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Whether a refund is possible at all: docs/07 §7.1 allows it from shipped or delivered. */
export function canRefund(status: OrderStatus): boolean {
  return status === 'shipped' || status === 'delivered';
}

/** docs/07 §7.4 — a customer may cancel their own order only while it is still pending. */
export function customerCanCancel(status: OrderStatus): boolean {
  return status === 'pending';
}

/** A postal address as stored in `orders.shipping_address` jsonb (snake_case, docs/03 §6). */
export interface OrderAddress {
  recipient_name?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

export interface OrderItem {
  id: string;
  name: string;
  sku: string;
  imagePath: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  variantId: string | null;
}

/** One row in a list. Deliberately small — a list of 50 should not fetch 50 order bodies. */
export interface OrderListRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  email: string;
  recipientName: string;
  city: string;
  itemCount: number;
  totalCents: number;
  placedAt: string;
  provider: string | null;
}

export interface OrderEvent {
  id: string;
  type: string;
  message: string | null;
  isCustomerVisible: boolean;
  createdAt: string;
  actorName: string | null;
}

export interface Shipment {
  id: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  shippedAt: string | null;
}

export interface Refund {
  id: string;
  amountCents: number;
  reason: string;
  restock: boolean;
  createdAt: string;
}

export interface Payment {
  id: string;
  provider: string;
  status: PaymentStatus;
  amountCents: number;
  providerRef: string | null;
}

/** The full order, as the admin detail page and the customer detail page render it. */
export interface OrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  email: string;
  phone: string;
  userId: string | null;
  locale: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  couponCode: string | null;
  customerNote: string | null;
  adminNote: string | null;
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  shippingMethodName: LocalizedField;
  minDays: number | null;
  maxDays: number | null;
  placedAt: string;
  deliveredAt: string | null;
  cancelledAt: string | null;
  items: OrderItem[];
  events: OrderEvent[];
  shipments: Shipment[];
  refunds: Refund[];
  payments: Payment[];
  /** Sum of refunds already issued, so the refund dialog can cap what it offers. */
  refundedCents: number;
}
