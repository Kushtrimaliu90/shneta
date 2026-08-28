import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/07 §8.1 — turn the subscribe-marked lines of a converted cart into a subscription.
 *
 * Runs **after** `checkout_create_order` has committed, deliberately. A subscription is a
 * promise about future deliveries; the order is the thing the customer just bought. Creating the
 * subscription inside the checkout transaction would mean a failure here rolls back an order
 * that was otherwise fine — trading a real sale for a schedule that can be recreated by hand.
 *
 * So this never throws. A failure is logged with the order number, and the customer has bought
 * what they bought.
 *
 * Service client: the cart is already converted and its rows are no longer readable under the
 * customer's own policies, and a guest cart has no `auth.uid()` at all. docs/02 §6 covers this
 * as a guest-cart operation.
 */

interface CreateInput {
  cartId: string;
  userId: string | null;
  shippingAddress: Json;
  shippingMethodId: string;
  paymentProvider: 'cod' | 'bank_pos' | 'stripe';
  orderNumber: string;
}

/** The default discount, from `settings.loyalty`-style config. Falls back to docs/07 §8.1's 10%. */
async function discountPct(): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'subscriptions')
    .maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const pct = value.discount_pct;
  return typeof pct === 'number' && pct >= 0 && pct <= 50 ? pct : 10;
}

/**
 * Creates or extends a subscription from the cart's subscribe-marked lines.
 *
 * Lines are grouped by cadence: someone who asks for vitamin D every 30 days and protein every
 * 60 gets two subscriptions, because one schedule cannot deliver on two rhythms. Grouping is the
 * whole reason this is not a single insert.
 *
 * An existing active subscription at the same cadence is **merged into** rather than duplicated
 * — otherwise a customer who subscribes to two products in two visits ends up with two deliveries
 * a month arriving separately, each paying its own shipping.
 */
export async function createSubscriptionsFromCart(input: CreateInput): Promise<void> {
  // docs/07 §8.1 — subscriptions belong to an account. A guest has nowhere to manage one, and
  // no way to prove ownership later, so their subscribe intent is dropped with a log line.
  if (!input.userId) {
    logger.info('Subscribe intent on a guest order was ignored', {
      orderNumber: input.orderNumber,
    });
    return;
  }

  try {
    const supabase = createAdminClient();

    const { data: lines, error } = await supabase
      .from('cart_items')
      .select('variant_id, quantity, subscribe_frequency_days')
      .eq('cart_id', input.cartId)
      .not('subscribe_frequency_days', 'is', null);

    if (error) {
      logger.error('Subscribe lines read failed', { cause: error.message });
      return;
    }

    const rows = (lines ?? []) as {
      variant_id: string;
      quantity: number;
      subscribe_frequency_days: number | null;
    }[];
    if (rows.length === 0) return;

    const pct = await discountPct();

    const byFrequency = new Map<number, { variant_id: string; quantity: number }[]>();
    for (const row of rows) {
      const days = row.subscribe_frequency_days;
      if (!days) continue;
      byFrequency.set(days, [
        ...(byFrequency.get(days) ?? []),
        { variant_id: row.variant_id, quantity: row.quantity },
      ]);
    }

    for (const [frequencyDays, items] of byFrequency) {
      const { data: existing } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', input.userId)
        .eq('status', 'active')
        .eq('frequency_days', frequencyDays)
        .limit(1)
        .maybeSingle();

      let subscriptionId = (existing as { id: string } | null)?.id ?? null;

      if (!subscriptionId) {
        /*
         * The first delivery is one full cycle away, not today. The customer has just been sent
         * these items — shipping them again immediately is the single most obvious way to make
         * a subscription feel like a trap.
         */
        const nextRunAt = new Date(Date.now() + frequencyDays * 24 * 60 * 60 * 1000).toISOString();

        const { data: created, error: createError } = await supabase
          .from('subscriptions')
          .insert({
            user_id: input.userId,
            status: 'active',
            frequency_days: frequencyDays,
            next_run_at: nextRunAt,
            discount_pct: pct,
            shipping_address: input.shippingAddress,
            shipping_method_id: input.shippingMethodId,
            payment_provider: input.paymentProvider,
          })
          .select('id')
          .single();

        if (createError || !created) {
          logger.error('Subscription create failed', {
            orderNumber: input.orderNumber,
            cause: createError?.message,
          });
          continue;
        }
        subscriptionId = (created as { id: string }).id;
      }

      for (const item of items) {
        const { data: line } = await supabase
          .from('subscription_items')
          .select('id, quantity')
          .eq('subscription_id', subscriptionId)
          .eq('variant_id', item.variant_id)
          .maybeSingle();

        const current = (line as { id: string; quantity: number } | null) ?? null;

        const { error: itemError } = current
          ? await supabase
              .from('subscription_items')
              // Re-subscribing to something already in the schedule *sets* the quantity rather
              // than adding to it: the customer asked for two, not for two more.
              .update({ quantity: item.quantity })
              .eq('id', current.id)
          : await supabase.from('subscription_items').insert({
              subscription_id: subscriptionId,
              variant_id: item.variant_id,
              quantity: item.quantity,
            });

        if (itemError) {
          logger.error('Subscription item write failed', {
            subscriptionId,
            cause: itemError.message,
          });
        }
      }

      logger.info('Subscription set up from order', {
        orderNumber: input.orderNumber,
        frequencyDays,
        items: items.length,
      });
    }
  } catch (error) {
    logger.error('createSubscriptionsFromCart threw', {
      orderNumber: input.orderNumber,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
