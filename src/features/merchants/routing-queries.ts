import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §6 — the reads behind `/admin/routing`.
 *
 * All three functions are staff-gated **inside the database**, not here: they raise `FORBIDDEN` for a
 * merchant rather than returning nothing, because they expose rival asking prices and stock levels and
 * a silent empty result would be the wrong shape of answer to a call that should not have happened.
 * The capability check on the page is the second layer, not the boundary.
 */

export interface RoutingQueueRow {
  fulfilmentId: string;
  orderId: string;
  orderNumber: string;
  placedAt: string;
  status: string;
  proposedMerchantId: string | null;
  proposedMerchantName: string | null;
  itemsSubtotalCents: number;
  lineCount: number;
  unitCount: number;
  /** Hours since the fulfilment was created — the SLA the auto-accept setting is measured against. */
  waitingHours: number;
  isCod: boolean;
}

export async function routingQueue(includeAssigned = false): Promise<RoutingQueueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('routing_queue', {
    p_include_assigned: includeAssigned,
  });

  if (error) {
    logger.error('routingQueue failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as {
      fulfilment_id: string;
      order_id: string;
      order_number: string;
      placed_at: string;
      status: string;
      proposed_merchant_id: string | null;
      proposed_merchant_name: string | null;
      items_subtotal_cents: number;
      line_count: number;
      unit_count: number;
      waiting_hours: number;
      is_cod: boolean;
    }[]
  ).map((row) => ({
    fulfilmentId: row.fulfilment_id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    placedAt: row.placed_at,
    status: row.status,
    proposedMerchantId: row.proposed_merchant_id,
    proposedMerchantName: row.proposed_merchant_name,
    itemsSubtotalCents: row.items_subtotal_cents,
    lineCount: row.line_count,
    unitCount: row.unit_count,
    waitingHours: Number(row.waiting_hours ?? 0),
    isCod: row.is_cod,
  }));
}

export interface Candidate {
  merchantId: string;
  merchantName: string;
  merchantSlug: string;
  ratingAvg: number;
  /** What this merchant wants for the whole fulfilment, at its own asking prices. */
  askingTotalCents: number;
  /** What settlement would pay it for the same fulfilment, from the retail subtotal. */
  merchantDueCents: number;
  commissionPct: number;
  maxHandlingDays: number;
  /** True for the merchant currently holding the stock reservation. */
  isCurrent: boolean;
}

export async function fulfilmentCandidates(fulfilmentId: string): Promise<Candidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fulfilment_candidates', {
    p_fulfilment_id: fulfilmentId,
  });

  if (error) {
    logger.error('fulfilmentCandidates failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as {
      merchant_id: string;
      merchant_name: string;
      merchant_slug: string;
      rating_avg: number;
      asking_total_cents: number;
      merchant_due_cents: number;
      commission_pct: number;
      max_handling_days: number;
      is_current: boolean;
    }[]
  ).map((row) => ({
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    merchantSlug: row.merchant_slug,
    ratingAvg: Number(row.rating_avg ?? 0),
    askingTotalCents: row.asking_total_cents,
    merchantDueCents: row.merchant_due_cents,
    commissionPct: Number(row.commission_pct ?? 0),
    maxHandlingDays: row.max_handling_days,
    isCurrent: row.is_current,
  }));
}

export interface FulfilmentLine {
  itemId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  offerId: string | null;
}

export async function fulfilmentLines(fulfilmentId: string): Promise<FulfilmentLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fulfilment_lines', {
    p_fulfilment_id: fulfilmentId,
  });

  if (error) {
    logger.error('fulfilmentLines failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as {
      item_id: string;
      sku: string;
      name_snapshot: string;
      quantity: number;
      unit_price_cents: number;
      total_cents: number;
      offer_id: string | null;
    }[]
  ).map((row) => ({
    itemId: row.item_id,
    sku: row.sku,
    name: row.name_snapshot,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    totalCents: row.total_cents,
    offerId: row.offer_id,
  }));
}

/** Fulfilments of one order, for the admin order detail page. */
export interface OrderFulfilment {
  id: string;
  fulfillerKind: 'biocode' | 'merchant';
  merchantId: string | null;
  merchantName: string | null;
  status: string;
  itemsSubtotalCents: number;
  commissionCents: number;
  merchantDueCents: number;
  carrier: string | null;
  trackingCode: string | null;
  assignedAt: string | null;
  shippedAt: string | null;
  cancelReason: string | null;
}

export async function orderFulfilments(orderId: string): Promise<OrderFulfilment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('order_fulfilments')
    .select(
      `id, fulfiller_kind, merchant_id, status, items_subtotal_cents, commission_cents,
       merchant_due_cents, carrier, tracking_code, assigned_at, shipped_at, cancel_reason,
       merchants ( display_name )`,
    )
    .eq('order_id', orderId)
    .order('fulfiller_kind', { ascending: false });

  if (error) {
    logger.error('orderFulfilments failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as unknown as {
      id: string;
      fulfiller_kind: 'biocode' | 'merchant';
      merchant_id: string | null;
      status: string;
      items_subtotal_cents: number;
      commission_cents: number;
      merchant_due_cents: number;
      carrier: string | null;
      tracking_code: string | null;
      assigned_at: string | null;
      shipped_at: string | null;
      cancel_reason: string | null;
      merchants: { display_name: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    fulfillerKind: row.fulfiller_kind,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.display_name ?? null,
    status: row.status,
    itemsSubtotalCents: row.items_subtotal_cents,
    commissionCents: row.commission_cents,
    merchantDueCents: row.merchant_due_cents,
    carrier: row.carrier,
    trackingCode: row.tracking_code,
    assignedAt: row.assigned_at,
    shippedAt: row.shipped_at,
    cancelReason: row.cancel_reason,
  }));
}
