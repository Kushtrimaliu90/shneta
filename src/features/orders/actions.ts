'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toCents } from '@/lib/money';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { sendOrderLifecycleEmail, templateForStatus } from '@/features/orders/email';
import {
  cancelSchema,
  customerCancelSchema,
  internalNoteSchema,
  refundSchema,
  shipmentSchema,
  transitionSchema,
} from '@/features/orders/schemas';
import { toOrderStatus } from '@/features/orders/types';

/**
 * docs/06 §2 / docs/07 §7 — admin order operations.
 *
 * These actions are deliberately thin, because the rules live in the database and must:
 *   · `orders_before_status_change` rejects an illegal transition — the only place that can
 *     read the current status atomically with the write, so no UI check can replace it;
 *   · `orders_after_status_change` writes the `order_events` row, restocks on cancel, settles
 *     COD and earns loyalty on delivered;
 *   · `refunds_after_insert` caps a refund at the order total, flips payment status, and claws
 *     loyalty back.
 *
 * So an action's whole job is: prove the caller may do this, write one row, audit it, email the
 * customer, revalidate. Anything more would be a second implementation of a rule that is
 * already enforced — and the two would drift.
 *
 * Every one re-checks its capability (docs/06 preamble) even though the layout already gated
 * the page: a server action is reachable by POST without the page ever rendering.
 */

export type OrderErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.orders.errors.invalidTransition'
  | 'admin.orders.errors.notFound'
  | 'admin.orders.errors.checkFields'
  | 'admin.orders.errors.refundTooLarge'
  | 'admin.orders.errors.refundInvalidAmount';

export type OrderActionState = ActionResult<{ status?: string }, OrderErrorKey> | null;

/** Pinned so inference cannot widen `E` back to `string` (the M4 lesson, docs/13 §F). */
function orderFail(error: OrderErrorKey): ActionResult<{ status?: string }, OrderErrorKey> {
  return fail<OrderErrorKey, { status?: string }>(error);
}

/**
 * The customer-facing cancel has its own key union, and the reason is not cosmetic.
 *
 * Every other action here is read by the **admin** panel, which has no next-intl provider
 * (docs/01 §3 — English only) and resolves these identifiers through a plain English record.
 * `requestCancelOrder` is read by the **account** pages, which are localized and resolve keys
 * through `t()`. One union serving both would mean either untranslatable admin strings or
 * message keys that exist for nobody.
 *
 * These three are real keys in `messages/{sq,en}.json` and `check:i18n` enforces the pair.
 */
export type CustomerCancelErrorKey =
  'order.cancel.errors.notFound' | 'order.cancel.errors.tooLate' | 'order.cancel.errors.generic';

export type CustomerCancelState = ActionResult<void, CustomerCancelErrorKey> | null;

function cancelFail(error: CustomerCancelErrorKey): ActionResult<void, CustomerCancelErrorKey> {
  return fail<CustomerCancelErrorKey>(error);
}

/**
 * Turns a Postgres error into a message key.
 *
 * `INVALID_STATUS_TRANSITION:pending->shipped` is the one worth naming: it means two operators
 * acted on the same order and the second lost the race, which is a real thing that happens in a
 * warehouse and deserves better than "something went wrong".
 */
function mapOrderError(message: string): OrderErrorKey {
  if (message.includes('INVALID_STATUS_TRANSITION')) {
    return 'admin.orders.errors.invalidTransition';
  }
  if (message.includes('REFUND_EXCEEDS_PAID_TOTAL')) {
    return 'admin.orders.errors.refundTooLarge';
  }
  return 'admin.errors.generic';
}

/** Both the admin detail page and the list need refreshing after any write. */
function revalidateOrder(orderId: string): void {
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${orderId}`);
  // The customer's own view of the same order (docs/05 §14).
  revalidatePath('/account/orders', 'layout');
}

/**
 * Moves an order along the state machine: confirm, process, ship, deliver.
 *
 * Shipping through *this* action rather than the shipment dialog is legitimate — an order can
 * be marked shipped without tracking details when the courier gives none — but the dialog is
 * the usual path and calls `createShipment`, which transitions as part of its own work.
 */
export async function transitionOrder(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const gate = await requireCapability('orders.transition');
  if (!gate.ok) return orderFail(gate.error);

  const parsed = transitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return orderFail('admin.orders.errors.checkFields');

  const { orderId, to, notify } = parsed.data;

  try {
    const supabase = await createClient();

    // Read the previous status for the audit row; `before`/`after` is the point of an audit.
    const { data: existing } = await supabase
      .from('orders')
      .select('status, payment_status')
      .eq('id', orderId)
      .maybeSingle();

    if (!existing) return orderFail('admin.orders.errors.notFound');
    const before = existing as { status: string; payment_status: string };

    const { error } = await supabase
      .from('orders')
      .update({ status: toOrderStatus(to) })
      .eq('id', orderId);

    if (error) {
      logger.info('Order transition rejected', { orderId, to, cause: error.message });
      return orderFail(mapOrderError(error.message));
    }

    await audit('order.status_changed', 'order', orderId, before, { status: to });

    if (notify) {
      const template = templateForStatus(to);
      // Awaited but non-throwing: the email module swallows its own failures (docs/07 §12).
      if (template) await sendOrderLifecycleEmail(orderId, template);
    }

    revalidateOrder(orderId);
    return ok({ status: to });
  } catch (error) {
    logger.error('transitionOrder threw', describeError(error));
    return orderFail('admin.errors.generic');
  }
}

/**
 * Cancels an order with a reason.
 *
 * Separate from `transitionOrder` because cancelling asks for something the others do not — a
 * reason, which goes into the timeline and is quoted in the customer's email. The restock is
 * not here: `orders_after_status_change` does it, for every caller, including a customer
 * cancelling their own order.
 */
export async function cancelOrder(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const gate = await requireCapability('orders.transition');
  if (!gate.ok) return orderFail(gate.error);

  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return orderFail('admin.orders.errors.checkFields');

  const { orderId, reason, notify } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .maybeSingle();

    if (!existing) return orderFail('admin.orders.errors.notFound');
    const before = existing as { status: string };

    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    if (error) {
      logger.info('Order cancel rejected', { orderId, cause: error.message });
      return orderFail(mapOrderError(error.message));
    }

    /*
     * The reason as a separate customer-visible event. The trigger already logged
     * "confirmed → cancelled"; this adds *why*, which is what the customer actually wants to
     * read and what support needs when they pick the conversation up later.
     */
    await supabase.from('order_events').insert({
      order_id: orderId,
      type: 'note',
      message: `Cancelled: ${reason}`,
      is_customer_visible: true,
    });

    await audit('order.cancelled', 'order', orderId, before, { status: 'cancelled', reason });

    if (notify) await sendOrderLifecycleEmail(orderId, 'order_cancelled', { reason });

    revalidateOrder(orderId);
    return ok({ status: 'cancelled' });
  } catch (error) {
    logger.error('cancelOrder threw', describeError(error));
    return orderFail('admin.errors.generic');
  }
}

/**
 * docs/06 §2 — creates a shipment and moves the order to `shipped`.
 *
 * One action rather than two steps, because a shipment that exists on an order still marked
 * `processing` is a lie the warehouse has to remember to correct. The shipment row is written
 * first: if the transition then fails (someone cancelled the order a second earlier) there is a
 * record of the attempt, which is better than a transition with no shipment to explain it.
 */
export async function createShipment(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const gate = await requireCapability('orders.ship');
  if (!gate.ok) return orderFail(gate.error);

  const parsed = shipmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return orderFail('admin.orders.errors.checkFields');

  const { orderId, carrier, trackingNumber, trackingUrl, notify } = parsed.data;

  try {
    const supabase = await createClient();

    const { error: shipmentError } = await supabase.from('shipments').insert({
      order_id: orderId,
      carrier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl || null,
      status: 'shipped',
      shipped_at: new Date().toISOString(),
    });

    if (shipmentError) {
      logger.error('Shipment insert failed', { orderId, cause: shipmentError.message });
      return orderFail('admin.errors.generic');
    }

    const { error: statusError } = await supabase
      .from('orders')
      .update({ status: 'shipped' })
      .eq('id', orderId);

    if (statusError) {
      logger.info('Ship transition rejected', { orderId, cause: statusError.message });
      return orderFail(mapOrderError(statusError.message));
    }

    await audit('order.shipped', 'order', orderId, null, {
      carrier,
      trackingNumber,
      trackingUrl: trackingUrl || null,
    });

    if (notify) {
      await sendOrderLifecycleEmail(orderId, 'order_shipped', {
        carrier,
        trackingNumber,
        trackingUrl: trackingUrl || undefined,
      });
    }

    revalidateOrder(orderId);
    return ok({ status: 'shipped' });
  } catch (error) {
    logger.error('createShipment threw', describeError(error));
    return orderFail('admin.errors.generic');
  }
}

/**
 * docs/07 §7.3 — issues a refund.
 *
 * `orders.refund` is a support-only capability: docs/01 §3 gives warehouse "orders/ship only",
 * and money is where that line matters most.
 *
 * The cap is **not** checked here. `refunds_after_insert` adds up existing refunds and raises
 * `REFUND_EXCEEDS_PAID_TOTAL` in the same transaction as the insert; checking first in
 * TypeScript would be a read-then-write race that two operators refunding at once would win
 * against. The UI still shows the remaining amount, so the error is a backstop rather than the
 * normal path.
 *
 * Restock is v1-simplified per docs/07 §7.3 — full refunds only. A partial refund with the
 * toggle on records the intent and leaves stock alone, because restocking "some of" an order
 * needs a per-line quantity prompt that v1 does not have.
 */
export async function refundOrder(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const gate = await requireCapability('orders.refund');
  if (!gate.ok) return orderFail(gate.error);

  const parsed = refundSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return orderFail('admin.orders.errors.checkFields');

  const { orderId, amount, reason, restock, notify } = parsed.data;

  let amountCents: number;
  try {
    // `toCents` throws on anything that is not a plain euro amount, which is what we want
    // from a free-text money field — silently coercing "1e3" to €1000 would not be.
    amountCents = toCents(amount);
  } catch {
    return orderFail('admin.orders.errors.refundInvalidAmount');
  }

  if (amountCents <= 0) return orderFail('admin.orders.errors.refundInvalidAmount');

  try {
    const supabase = await createClient();

    const { data: order } = await supabase
      .from('orders')
      .select('total_cents, payment_status, status')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return orderFail('admin.orders.errors.notFound');
    const before = order as { total_cents: number; payment_status: string; status: string };

    const { error } = await supabase.from('refunds').insert({
      order_id: orderId,
      amount_cents: amountCents,
      reason,
      restock,
    });

    if (error) {
      logger.info('Refund rejected', { orderId, cause: error.message });
      return orderFail(mapOrderError(error.message));
    }

    /*
     * docs/07 §7.3 — restock on a full refund only. `apply_stock_movement` is the sanctioned
     * way to move `on_hand` (docs/13 §A7); writing `refund_restock` rows by hand would break
     * the ledger invariant the same way the cancel path would if it bypassed its trigger.
     */
    if (restock && amountCents >= before.total_cents) {
      const { data: warehouse } = await supabase
        .from('warehouses')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();

      const { data: items } = await supabase
        .from('order_items')
        .select('variant_id, quantity')
        .eq('order_id', orderId)
        .not('variant_id', 'is', null);

      const warehouseRow = warehouse as { id: string } | null;

      if (warehouseRow) {
        for (const item of (items ?? []) as { variant_id: string; quantity: number }[]) {
          const { error: stockError } = await supabase.rpc('apply_stock_movement', {
            p_variant_id: item.variant_id,
            p_warehouse_id: warehouseRow.id,
            p_type: 'refund_restock',
            p_quantity: item.quantity,
            p_reference_type: 'order',
            p_reference_id: orderId,
            p_note: `Refund restock: ${reason}`,
          });
          // Logged, not fatal: the refund is already issued and money matters more than a
          // stock row an operator can correct with a manual adjustment.
          if (stockError) {
            logger.error('Refund restock failed', {
              orderId,
              variantId: item.variant_id,
              cause: stockError.message,
            });
          }
        }
      }
    }

    await audit('order.refunded', 'order', orderId, before, { amountCents, reason, restock });

    if (notify) await sendOrderLifecycleEmail(orderId, 'refund_issued', { amountCents, reason });

    revalidateOrder(orderId);
    return ok({});
  } catch (error) {
    logger.error('refundOrder threw', describeError(error));
    return orderFail('admin.errors.generic');
  }
}

/**
 * docs/07 §7.4 — a customer cancelling their own order.
 *
 * The only order action in this file that is not staff-gated, and it needs no capability check
 * because RLS is doing the work: `p_staff_update on orders` is the *only* update policy, so a
 * customer cannot write to `orders` at all. Which means this has to go through the service
 * client — and that is a decision worth stating plainly rather than reaching for.
 *
 * The alternative was a `security definer` RPC, which would be the more orthodox answer. It is
 * not obviously better here: the RPC would need the same ownership-and-status check this
 * function makes, in PL/pgSQL, and would add a migration to review. What makes the service
 * client acceptable is that the check below is exhaustive and narrow — the row must belong to
 * this user *and* still be pending — and the trigger enforces the transition regardless. If a
 * second customer-write path ever appears, the RPC becomes the right call and this should move.
 */
export async function requestCancelOrder(
  _previous: CustomerCancelState,
  formData: FormData,
): Promise<CustomerCancelState> {
  const parsed = customerCancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return cancelFail('order.cancel.errors.notFound');

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return cancelFail('order.cancel.errors.notFound');

    /*
     * Read under the caller's own RLS first. This is what proves ownership: `p_read on orders`
     * restricts a customer to `user_id = auth.uid()`, so an order number belonging to somebody
     * else simply is not found here — before the service client is involved at all.
     */
    const { data: owned } = await supabase
      .from('orders')
      .select('id, status, user_id')
      .eq('order_number', parsed.data.orderNumber)
      .maybeSingle();

    const order = owned as { id: string; status: string; user_id: string | null } | null;
    if (!order || order.user_id !== user.id) return cancelFail('order.cancel.errors.notFound');

    // docs/07 §7.4 — pending only; afterwards the UI shows a contact-support CTA instead.
    if (order.status !== 'pending') return cancelFail('order.cancel.errors.tooLate');

    const admin = createAdminClient();
    const { error } = await admin.from('orders').update({ status: 'cancelled' }).eq('id', order.id);

    if (error) {
      logger.info('Customer cancel rejected', { orderId: order.id, cause: error.message });
      return cancelFail('order.cancel.errors.tooLate');
    }

    await admin.from('order_events').insert({
      order_id: order.id,
      type: 'note',
      message: 'Cancelled by the customer.',
      is_customer_visible: true,
    });

    // The stock came back via `orders_after_status_change`, same as an admin cancel.
    await sendOrderLifecycleEmail(order.id, 'order_cancelled', {
      reason: 'Cancelled by the customer',
    });

    revalidateOrder(order.id);
    return ok(undefined);
  } catch (error) {
    logger.error('requestCancelOrder threw', describeError(error));
    return cancelFail('order.cancel.errors.generic');
  }
}

/**
 * docs/06 §2 — an internal note on the timeline.
 *
 * `is_customer_visible: false`, which is the entire purpose: staff need somewhere to write
 * "customer called, rescheduling to Thursday" that the customer will not read. The customer
 * timeline filters on that column through RLS (`p_read on order_events`), so this is enforced
 * in the database and not by remembering to filter in a query.
 */
export async function addInternalNote(
  _previous: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const gate = await requireCapability('orders.view');
  if (!gate.ok) return orderFail(gate.error);

  const parsed = internalNoteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return orderFail('admin.orders.errors.checkFields');

  const { orderId, message } = parsed.data;

  try {
    const supabase = await createClient();

    const { error } = await supabase.from('order_events').insert({
      order_id: orderId,
      type: 'note',
      message,
      is_customer_visible: false,
      created_by: gate.actor.id,
    });

    if (error) {
      logger.error('Internal note insert failed', { orderId, cause: error.message });
      return orderFail('admin.errors.generic');
    }

    await audit('order.note_added', 'order', orderId, null, { message });

    revalidateOrder(orderId);
    return ok({});
  } catch (error) {
    logger.error('addInternalNote threw', describeError(error));
    return orderFail('admin.errors.generic');
  }
}
