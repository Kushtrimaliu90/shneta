import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { toOrderStatus, type OrderStatus } from '@/features/orders/types';

/**
 * docs/06 §1 — dashboard data.
 *
 * Everything through the SSR client, so a role that cannot read orders gets an empty dashboard
 * rather than a forbidden page. The cards are then filtered by capability in the page — a
 * warehouse manager should see low stock and the confirmation queue, not revenue.
 *
 * These are deliberately simple aggregates computed in TypeScript over a bounded window rather
 * than SQL `group by`s per card. At a Kosovo launch's volume that is a handful of rows and one
 * round trip instead of six; when it stops being true, `v_admin_daily_sales` is already there
 * and the right answer is a materialised view, not six queries.
 */

export interface DailyPoint {
  day: string;
  orders: number;
  revenueCents: number;
}

export interface KpiWindow {
  orders: number;
  revenueCents: number;
  /** Average order value. Null rather than 0 when there are no orders — they differ. */
  aovCents: number | null;
}

export interface DashboardData {
  today: KpiWindow;
  last7: KpiWindow;
  last30: KpiWindow;
  /** Oldest first — the queue an operator should work through top-down. */
  awaitingConfirmation: {
    id: string;
    orderNumber: string;
    placedAt: string;
    totalCents: number;
    recipientName: string;
  }[];
  lowStock: { sku: string; productName: string; onHand: number; threshold: number }[];
  statusCounts: Partial<Record<OrderStatus, number>>;
  /** 30 days, oldest first, with gaps filled so the chart has no missing bars. */
  daily: DailyPoint[];
}

interface RawOrder {
  id: string;
  order_number: string;
  status: string;
  placed_at: string;
  total_cents: number;
  shipping_address: { recipient_name?: string | null } | null;
}

/**
 * The Belgrade calendar day an instant falls in, as `YYYY-MM-DD`.
 *
 * "Today" on a revenue card has to mean the operator's today, not UTC's — for two hours every
 * evening those differ, and a figure that resets at 02:00 local is the kind of error nobody
 * notices until month end. `sv-SE` yields ISO-shaped output without a format string; it is a
 * formatting trick, not a language choice.
 */
function belgradeDay(instant: Date): string {
  return instant.toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
}

/** Turns one day's bucket into a KPI window. */
function toKpi(bucket: { orders: number; revenueCents: number }): KpiWindow {
  return {
    orders: bucket.orders,
    revenueCents: bucket.revenueCents,
    aovCents: bucket.orders > 0 ? Math.round(bucket.revenueCents / bucket.orders) : null,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [ordersResult, lowStockResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, placed_at, total_cents, shipping_address')
      .gte('placed_at', since30.toISOString())
      .order('placed_at', { ascending: false }),
    supabase
      .from('v_low_stock')
      .select('sku, product_name, on_hand, low_stock_threshold')
      .order('on_hand')
      .limit(10),
  ]);

  if (ordersResult.error) {
    logger.error('Dashboard orders read failed', { cause: ordersResult.error.message });
  }

  const orders = (ordersResult.data ?? []) as unknown as RawOrder[];

  const statusCounts: Partial<Record<OrderStatus, number>> = {};
  for (const order of orders) {
    const status = toOrderStatus(order.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  /*
   * Bucket by Belgrade calendar day and fill the gaps. A chart that silently omits a zero day
   * compresses the axis and makes a quiet week look busy — the flat stretch is the information.
   */
  const byDay = new Map<string, { orders: number; revenueCents: number }>();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    const day = belgradeDay(new Date(order.placed_at));
    const bucket = byDay.get(day) ?? { orders: 0, revenueCents: 0 };
    bucket.orders += 1;
    bucket.revenueCents += order.total_cents;
    byDay.set(day, bucket);
  }

  const daily: DailyPoint[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const day = belgradeDay(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000));
    const bucket = byDay.get(day) ?? { orders: 0, revenueCents: 0 };
    daily.push({ day, orders: bucket.orders, revenueCents: bucket.revenueCents });
  }

  /*
   * The KPI windows are summed from `daily`, not recomputed from `orders`.
   *
   * That is the whole reason the timezone gymnastics went away: "today" is simply the last
   * bucket, and a 7-day figure is the last seven. It also removes a class of bug — a card and
   * the chart beside it computing the same number two different ways will eventually disagree,
   * and the operator has no way to tell which one lied.
   */
  const sum = (points: DailyPoint[]) =>
    points.reduce(
      (acc, point) => ({
        orders: acc.orders + point.orders,
        revenueCents: acc.revenueCents + point.revenueCents,
      }),
      { orders: 0, revenueCents: 0 },
    );

  const awaitingConfirmation = orders
    .filter((order) => order.status === 'pending')
    // Oldest first: the queue is worked top-down, and the oldest is the one keeping a customer
    // waiting longest.
    .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
    .slice(0, 10)
    .map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      placedAt: order.placed_at,
      totalCents: order.total_cents,
      recipientName: order.shipping_address?.recipient_name ?? '',
    }));

  // The view's column is `low_stock_threshold`, not `threshold` — the generated types caught
  // the guess, which is the argument for regenerating them after every migration (CLAUDE.md §1).
  const lowStock = (
    (lowStockResult.data ?? []) as {
      sku: string;
      product_name: string;
      on_hand: number;
      low_stock_threshold: number;
    }[]
  ).map((row) => ({
    sku: row.sku,
    productName: row.product_name,
    onHand: row.on_hand,
    threshold: row.low_stock_threshold,
  }));

  return {
    today: toKpi(sum(daily.slice(-1))),
    last7: toKpi(sum(daily.slice(-7))),
    last30: toKpi(sum(daily)),
    awaitingConfirmation,
    lowStock,
    statusCounts,
    daily,
  };
}
