import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';
import {
  sendSubscriptionNotice,
  sendSubscriptionOrder,
  sendSubscriptionPaused,
  sendSubscriptionSkipped,
} from '@/features/subscriptions/email';

/**
 * docs/07 §8.2 — the renewal engine.
 *
 * Service client throughout: a cron job has no session, and building an order on a customer's
 * behalf is one of the six sanctioned uses in docs/02 §6.
 *
 * The whole design rests on one property — **claim before build**. `claim_due_subscription`
 * advances `next_run_at` in the same statement that decides the subscription is due, so a second
 * invocation gets nothing back. Everything after the claim can fail freely; the worst outcome is
 * one missed delivery, never a duplicate order. docs/12 M9 names double-invoke-one-order as an
 * acceptance criterion, and this is where it is satisfied.
 */

export interface RunSummary {
  noticesSent: number;
  ordersCreated: number;
  cyclesSkipped: number;
  failures: number;
}

/** The system coupon that carries the subscription discount (docs/07 §8.2, docs/13 §A3). */
function discountCode(pct: number): string {
  return `SUB-${pct}`;
}

/**
 * T−3 notices (docs/07 §8.2).
 *
 * One token per action per notice, expiring an hour after the delivery would have gone out.
 * Not a durable per-subscription token: a forwarded email would then let anyone skip that
 * subscription for ever. See migration 17.
 *
 * A subscription that already has an unused, unexpired notice token is skipped, so re-running
 * the cron in the same window does not send the same customer three emails.
 */
export async function sendDueNotices(now: Date): Promise<number> {
  const supabase = createAdminClient();
  const horizon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('subscriptions')
    .select(
      'id, user_id, next_run_at, frequency_days, profiles ( email, full_name, preferred_locale )',
    )
    .eq('status', 'active')
    .gt('next_run_at', now.toISOString())
    .lte('next_run_at', horizon)
    .limit(200);

  if (error) {
    logger.error('sendDueNotices query failed', { cause: error.message });
    return 0;
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    next_run_at: string;
    profiles: { email: string; full_name: string | null; preferred_locale: string } | null;
  }[];

  let sent = 0;

  for (const row of rows) {
    if (!row.profiles?.email) continue;

    const { count } = await supabase
      .from('subscription_action_tokens')
      .select('token', { count: 'exact', head: true })
      .eq('subscription_id', row.id)
      .is('used_at', null)
      .gt('expires_at', now.toISOString());

    // Already noticed for this cycle. Re-running the cron must not re-mail anyone.
    if ((count ?? 0) > 0) continue;

    const expires = new Date(Date.parse(row.next_run_at) + 60 * 60 * 1000).toISOString();

    const { data: tokens, error: tokenError } = await supabase
      .from('subscription_action_tokens')
      .insert([
        { subscription_id: row.id, action: 'skip', expires_at: expires },
        { subscription_id: row.id, action: 'pause', expires_at: expires },
      ])
      .select('token, action');

    if (tokenError || !tokens) {
      logger.error('Notice token mint failed', { id: row.id, cause: tokenError?.message });
      continue;
    }

    const byAction = new Map(
      (tokens as { token: string; action: string }[]).map((t) => [t.action, t.token]),
    );

    await sendSubscriptionNotice({
      to: row.profiles.email,
      locale: row.profiles.preferred_locale === 'en' ? 'en' : 'sq',
      deliveryDate: row.next_run_at.slice(0, 10),
      skipToken: byAction.get('skip') ?? '',
      pauseToken: byAction.get('pause') ?? '',
    });

    sent += 1;
  }

  return sent;
}

interface ClaimedSubscription {
  id: string;
  user_id: string;
  discount_pct: number;
  /*
   * `Json`, not `Record<string, unknown>`. The address is passed straight back into
   * `checkout_create_order`, whose parameter is the generated `Json` type, and a loose record is
   * not assignable to it — correctly, since `Json` excludes the values Postgres cannot store.
   * Carrying the right type from the claim to the call is cheaper than casting at the boundary.
   */
  shipping_address: Json;
  shipping_method_id: string | null;
  payment_provider: 'cod' | 'bank_pos' | 'stripe';
  items: { variant_id: string; quantity: number }[];
}

/**
 * Runs every due subscription once.
 *
 * The order is built the same way a customer's is: a real cart, then `checkout_create_order`.
 * Not order surgery — docs/07 §8.2 chose the coupon route precisely so the renewal path and the
 * checkout path cannot price the same basket differently. Stock, coupons, totals and the state
 * machine all behave identically because it is literally the same transaction.
 */
export async function runDueSubscriptions(now: Date): Promise<RunSummary> {
  const supabase = createAdminClient();
  const summary: RunSummary = { noticesSent: 0, ordersCreated: 0, cyclesSkipped: 0, failures: 0 };

  const { data: due, error } = await supabase
    .from('v_subscription_schedule')
    .select('id')
    .eq('is_due', true)
    .eq('is_runnable', true)
    .limit(200);

  if (error) {
    logger.error('runDueSubscriptions query failed', { cause: error.message });
    return summary;
  }

  for (const row of (due ?? []) as { id: string | null }[]) {
    if (!row.id) continue;

    const { data: claimed, error: claimError } = await supabase.rpc('claim_due_subscription', {
      p_subscription_id: row.id,
    });

    if (claimError) {
      logger.error('Subscription claim failed', { id: row.id, cause: claimError.message });
      summary.failures += 1;
      continue;
    }

    // Null means somebody else claimed it — a concurrent run, or this one invoked twice.
    // Not an error: it is the idempotency guarantee working.
    if (!claimed) continue;

    const subscription = claimed as unknown as ClaimedSubscription;

    if (subscription.items.length === 0) {
      /*
       * Every line is unbuyable — withdrawn, or the whole basket went out of print. docs/07
       * §8.2: skip the cycle and say so. The claim already moved the date, so the customer is
       * simply not charged this month rather than left with a stuck subscription.
       */
      summary.cyclesSkipped += 1;
      await notifySkipped(subscription.id, 'no_items');
      continue;
    }

    try {
      const orderNumber = await buildOrder(subscription, now);
      if (orderNumber) {
        summary.ordersCreated += 1;
        await supabase.rpc('record_subscription_success', { p_subscription_id: subscription.id });
      } else {
        summary.cyclesSkipped += 1;
      }
    } catch (cause) {
      summary.failures += 1;
      logger.error('Subscription run failed', {
        id: subscription.id,
        cause: cause instanceof Error ? cause.message : String(cause),
      });

      const { data: failures } = await supabase.rpc('record_subscription_failure', {
        p_subscription_id: subscription.id,
      });

      // docs/07 §8.2 — three in a row pauses it, and the customer is told why.
      if (typeof failures === 'number' && failures >= 3) {
        await notifyPaused(subscription.id);
      }
    }
  }

  return summary;
}

/** Builds one subscription order. Returns the order number, or null if the cycle was skipped. */
async function buildOrder(subscription: ClaimedSubscription, now: Date): Promise<string | null> {
  const supabase = createAdminClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, phone, preferred_locale')
    .eq('id', subscription.user_id)
    .maybeSingle();

  const customer = profile as {
    email: string;
    phone: string | null;
    preferred_locale: string;
  } | null;

  if (!customer?.email) throw new Error('subscription owner has no email');

  /*
   * A real cart row, created and thrown away.
   *
   * `checkout_create_order` reads a cart — that is its contract, and the reason the renewal
   * path reuses it rather than inserting order rows directly. The cart is marked `converted`
   * by the RPC on success; on failure it is deleted below so the housekeeping sweep is not
   * left tidying up after the engine.
   */
  const { data: cart, error: cartError } = await supabase
    .from('carts')
    .insert({ user_id: subscription.user_id, status: 'active' })
    .select('id')
    .single();

  if (cartError || !cart) throw new Error(`cart create failed: ${cartError?.message}`);
  const cartId = (cart as { id: string }).id;

  try {
    const { error: itemsError } = await supabase.from('cart_items').insert(
      subscription.items.map((item) => ({
        cart_id: cartId,
        variant_id: item.variant_id,
        quantity: item.quantity,
      })),
    );
    if (itemsError) throw new Error(`cart items failed: ${itemsError.message}`);

    /*
     * The discount is a real coupon, and `SUB-<pct>` has to exist for the pct in settings.
     *
     * `checkout_create_order` raises `COUPON_INVALID` for an unknown code, which would surface
     * as an unexplained failed run — so it is checked here, by name. The failure mode this
     * guards is somebody changing `settings.subscriptions.discount_pct` to 15 without minting
     * `SUB-15`: every subscription in the shop then silently stops delivering.
     *
     * Failing the run is the right response. The alternative — dropping the coupon and shipping
     * at full price — charges a customer more than they agreed to, which is worse than a late
     * delivery and much harder to notice.
     */
    const code = discountCode(subscription.discount_pct);
    const { count: couponExists } = await supabase
      .from('coupons')
      .select('id', { count: 'exact', head: true })
      .eq('code', code)
      .eq('is_active', true);

    if ((couponExists ?? 0) === 0) {
      throw new Error(
        `subscription coupon ${code} is missing — mint it or reset settings.subscriptions.discount_pct`,
      );
    }

    const { data, error } = await supabase.rpc('checkout_create_order', {
      p_cart_id: cartId,
      p_email: customer.email,
      p_phone: customer.phone ?? '',
      p_shipping_address: subscription.shipping_address,
      p_billing_address: subscription.shipping_address,
      p_shipping_method_id: subscription.shipping_method_id ?? '',
      p_payment_provider: subscription.payment_provider,
      p_coupon_code: code,
      p_locale: customer.preferred_locale === 'en' ? 'en' : 'sq',
      p_customer_note: 'Subscription delivery',
    });

    if (error) throw new Error(`checkout failed: ${error.message}`);

    const result = data as { order_id?: string; order_number?: string } | null;
    if (!result?.order_id) throw new Error('checkout returned no order');

    // Link it back, so the account page and the admin list can show what the subscription has
    // generated. `orders.subscription_id` is the only edge between the two.
    const { error: linkError } = await supabase
      .from('orders')
      .update({ subscription_id: subscription.id })
      .eq('id', result.order_id);

    if (linkError) {
      // The order exists and the customer will be charged for it; failing the run here would
      // retry and create a second one. Logged loudly instead.
      logger.error('Subscription order link failed', {
        orderId: result.order_id,
        subscriptionId: subscription.id,
        cause: linkError.message,
      });
    }

    await sendSubscriptionOrder({
      to: customer.email,
      locale: customer.preferred_locale === 'en' ? 'en' : 'sq',
      orderNumber: result.order_number ?? '',
      nextDate: new Date(now.getTime()).toISOString().slice(0, 10),
    });

    return result.order_number ?? '';
  } catch (cause) {
    await supabase.from('cart_items').delete().eq('cart_id', cartId);
    await supabase.from('carts').delete().eq('id', cartId);
    throw cause;
  }
}

async function notifySkipped(subscriptionId: string, reason: string): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('profiles ( email, preferred_locale )')
    .eq('id', subscriptionId)
    .maybeSingle();

  const profile = (data as { profiles: { email: string; preferred_locale: string } | null } | null)
    ?.profiles;
  if (!profile?.email) return;

  await sendSubscriptionSkipped({
    to: profile.email,
    locale: profile.preferred_locale === 'en' ? 'en' : 'sq',
    reason,
  });
}

async function notifyPaused(subscriptionId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('profiles ( email, preferred_locale )')
    .eq('id', subscriptionId)
    .maybeSingle();

  const profile = (data as { profiles: { email: string; preferred_locale: string } | null } | null)
    ?.profiles;
  if (!profile?.email) return;

  await sendSubscriptionPaused({
    to: profile.email,
    locale: profile.preferred_locale === 'en' ? 'en' : 'sq',
  });
}
