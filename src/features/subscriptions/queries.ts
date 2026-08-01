import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField } from '@/lib/i18n';
import { getCurrentUser } from '@/features/auth/queries';
import {
  toSubscriptionStatus,
  type AdminSubscriptionRow,
  type SubscriptionStatus,
  type SubscriptionView,
} from '@/features/subscriptions/types';

/**
 * docs/05 §14 and docs/06 §12 — subscription reads.
 *
 * Through the SSR client, so RLS decides who sees what: `p_own on subscriptions` scopes a
 * customer to their own, and support reads any. That is why `listSubscriptions` needs no user
 * filter and `listAdminSubscriptions` needs no role check — the same query serves both callers
 * and returns different rows.
 */

const ITEM_SELECT = `id, quantity, variant_id,
  product_variants (
    sku, name, price_cents, is_active,
    products ( slug, name, status, deleted_at, product_images ( storage_path, position ) )
  )`;

interface RawItem {
  id: string;
  quantity: number;
  variant_id: string;
  product_variants: {
    sku: string;
    name: unknown;
    price_cents: number;
    is_active: boolean;
    products: {
      slug: string;
      name: unknown;
      status: string;
      deleted_at: string | null;
      product_images: { storage_path: string; position: number }[];
    } | null;
  } | null;
}

interface RawSubscription {
  id: string;
  status: string;
  frequency_days: number;
  next_run_at: string;
  paused_until: string | null;
  discount_pct: number;
  consecutive_failures: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
  subscription_items: RawItem[];
  orders: { order_number: string; placed_at: string; total_cents: number; status: string }[];
}

const SUBSCRIPTION_SELECT = `id, status, frequency_days, next_run_at, paused_until, discount_pct,
  consecutive_failures, cancelled_at, cancel_reason,
  subscription_items ( ${ITEM_SELECT} ),
  orders ( order_number, placed_at, total_cents, status )`;

function toView(row: RawSubscription): SubscriptionView {
  const items = row.subscription_items.map((item) => {
    const variant = item.product_variants;
    const product = variant?.products;
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.position - b.position);

    return {
      id: item.id,
      variantId: item.variant_id,
      quantity: item.quantity,
      sku: variant?.sku ?? '',
      productSlug: product?.slug ?? '',
      productName: asLocalizedField(product?.name),
      variantName: asLocalizedField(variant?.name),
      imagePath: images[0]?.storage_path ?? null,
      priceCents: variant?.price_cents ?? 0,
      /*
       * Whether the renewal engine will actually be able to buy this line. A variant that has
       * been deactivated, or whose product was unpublished, is shown struck-through rather than
       * hidden — the customer should find out from their subscription page, not from an order
       * that quietly arrives one item short (docs/07 §8.2).
       */
      isAvailable:
        (variant?.is_active ?? false) &&
        product?.status === 'published' &&
        product.deleted_at === null,
    };
  });

  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);

  return {
    id: row.id,
    status: toSubscriptionStatus(row.status),
    frequencyDays: row.frequency_days,
    nextRunAt: row.next_run_at,
    pausedUntil: row.paused_until,
    discountPct: row.discount_pct,
    consecutiveFailures: row.consecutive_failures,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    items,
    subtotalCents,
    discountCents: Math.round((subtotalCents * row.discount_pct) / 100),
    orders: [...row.orders]
      .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      .map((order) => ({
        orderNumber: order.order_number,
        placedAt: order.placed_at,
        totalCents: order.total_cents,
        status: order.status,
      })),
  };
}

/** docs/05 §14 — the customer's own subscriptions, cancelled ones last. */
export async function listSubscriptions(): Promise<SubscriptionView[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error('listSubscriptions failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as RawSubscription[])
    .map(toView)
    .sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'));
}

export async function getSubscription(id: string): Promise<SubscriptionView | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('getSubscription failed', { id, cause: error.message });
    return null;
  }
  return data ? toView(data as unknown as RawSubscription) : null;
}

/** docs/06 §12 — the admin list. */
export async function listAdminSubscriptions(
  status?: SubscriptionStatus,
): Promise<AdminSubscriptionRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('subscriptions')
    .select(
      `id, status, frequency_days, next_run_at, consecutive_failures,
       profiles ( email, full_name ),
       subscription_items ( id ),
       orders ( id )`,
    )
    // Soonest first: the list is a schedule, and what an operator needs is what runs next.
    .order('next_run_at', { ascending: true })
    .limit(100);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listAdminSubscriptions failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as unknown as {
      id: string;
      status: string;
      frequency_days: number;
      next_run_at: string;
      consecutive_failures: number;
      profiles: { email: string; full_name: string | null } | null;
      subscription_items: { id: string }[];
      orders: { id: string }[];
    }[]
  ).map((row) => ({
    id: row.id,
    status: toSubscriptionStatus(row.status),
    frequencyDays: row.frequency_days,
    nextRunAt: row.next_run_at,
    consecutiveFailures: row.consecutive_failures,
    customerEmail: row.profiles?.email ?? '',
    customerName: row.profiles?.full_name ?? '',
    itemCount: row.subscription_items.length,
    orderCount: row.orders.length,
  }));
}

export async function countAdminSubscriptions(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('subscriptions').select('status');

  if (error) {
    logger.error('countAdminSubscriptions failed', { cause: error.message });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    counts.all = (counts.all ?? 0) + 1;
  }
  return counts;
}
