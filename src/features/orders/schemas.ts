import { z } from 'zod';
import { ORDER_STATUSES } from '@/features/orders/types';

/** docs/02 §7 — one schema per mutation, reused on both sides of the boundary. */

const uuid = z.string().uuid();

/**
 * A status transition. The *target* is validated here; whether it is reachable from the
 * current status is decided by `orders_before_status_change`, which is the only place that can
 * know the current status at the moment of the write without a race.
 *
 * `refunded` is excluded: it is not a transition anyone triggers, it is what inserting a
 * refund produces (docs/07 §7.3).
 */
export const transitionSchema = z.object({
  orderId: uuid,
  to: z.enum(ORDER_STATUSES.filter((status) => status !== 'refunded') as [string, ...string[]]),
  /** docs/06 §2 — "notify customer", default on. */
  notify: z.coerce.boolean().default(true),
});

/** Cancelling asks for a reason, because the customer email quotes it. */
export const cancelSchema = z.object({
  orderId: uuid,
  reason: z.string().trim().min(3, 'REASON_REQUIRED').max(300),
  notify: z.coerce.boolean().default(true),
});

/**
 * docs/06 §2 — the shipment dialog. Carrier and tracking number are what the customer needs;
 * the URL is optional because not every Kosovo courier publishes one.
 */
export const shipmentSchema = z.object({
  orderId: uuid,
  carrier: z.string().trim().min(2, 'REQUIRED').max(80),
  trackingNumber: z.string().trim().min(2, 'REQUIRED').max(120),
  trackingUrl: z.union([z.string().trim().url('INVALID_URL').max(500), z.literal('')]).optional(),
  notify: z.coerce.boolean().default(true),
});

/**
 * docs/07 §7.3 — refund.
 *
 * The amount is in euros as typed by a human and converted to cents by the action, not here:
 * `toCents` throws on garbage with a message worth showing, and Zod's own coercion would
 * silently accept `1e3`. The cap (≤ amount paid) is enforced by `refunds_after_insert`, which
 * is the only place that can add up existing refunds atomically with the new one.
 */
export const refundSchema = z.object({
  orderId: uuid,
  amount: z.string().trim().min(1, 'REQUIRED'),
  reason: z.string().trim().min(3, 'REASON_REQUIRED').max(300),
  /** v1 restocks on full refund only (docs/07 §7.3); the toggle records intent either way. */
  restock: z.coerce.boolean().default(false),
  notify: z.coerce.boolean().default(true),
});

/** An internal note on the timeline. Never customer-visible — that is the whole point. */
export const internalNoteSchema = z.object({
  orderId: uuid,
  message: z.string().trim().min(1, 'REQUIRED').max(2000),
});

/** docs/07 §7.4 — a customer cancelling their own pending order. */
export const customerCancelSchema = z.object({
  orderNumber: z.string().trim().min(6).max(40),
});
