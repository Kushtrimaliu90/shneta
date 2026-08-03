import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §3, §7 — what a merchant may read about the orders it fulfils.
 *
 * Every read goes through a security-definer function with a **fixed shape**, never through a join the
 * portal composes. That is the whole architecture of §3: merchants are not granted select on `orders`
 * at all, so there is no join for a future feature to widen and no column allowlist for anyone to
 * forget to maintain.
 *
 * Two functions, two shapes, and the difference between them is deliberate:
 *
 *   · `merchant_fulfilment_list` — a screen somebody scrolls. No address, ever.
 *   · `merchant_fulfilment_view` — the one parcel they are about to pack. The address, once assigned.
 */

export type FulfilmentStatus =
  | 'unassigned'
  | 'assigned'
  | 'accepted'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface FulfilmentSummary {
  id: string;
  status: FulfilmentStatus;
  createdAt: string;
  assignedAt: string | null;
  acceptedAt: string | null;
  shippedAt: string | null;
  carrier: string | null;
  trackingCode: string | null;
  itemsSubtotalCents: number;
  commissionCents: number;
  merchantDueCents: number;
  orderNumber: string;
  placedAt: string;
  lineCount: number;
  unitCount: number;
  /** This fulfilment's subtotal when the order is COD, zero otherwise. Never the order total. */
  codAmountCents: number;
}

const STATUSES: readonly FulfilmentStatus[] = [
  'unassigned',
  'assigned',
  'accepted',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
];

function toStatus(value: unknown): FulfilmentStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as FulfilmentStatus)
    : 'unassigned';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function listMyFulfilments(status?: FulfilmentStatus): Promise<FulfilmentSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_fulfilment_list', {
    p_status: status ?? undefined,
  });

  if (error) {
    logger.error('listMyFulfilments failed', { cause: error.message });
    return [];
  }

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

  return rows.map((row) => ({
    id: asText(row.id),
    status: toStatus(row.status),
    createdAt: asText(row.created_at),
    assignedAt: asNullableText(row.assigned_at),
    acceptedAt: asNullableText(row.accepted_at),
    shippedAt: asNullableText(row.shipped_at),
    carrier: asNullableText(row.carrier),
    trackingCode: asNullableText(row.tracking_code),
    itemsSubtotalCents: asNumber(row.items_subtotal_cents),
    commissionCents: asNumber(row.commission_cents),
    merchantDueCents: asNumber(row.merchant_due_cents),
    orderNumber: asText(row.order_number),
    placedAt: asText(row.placed_at),
    lineCount: asNumber(row.line_count),
    unitCount: asNumber(row.unit_count),
    codAmountCents: asNumber(row.cod_amount_cents),
  }));
}

export async function myFulfilmentCounts(): Promise<Record<FulfilmentStatus, number>> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<
    FulfilmentStatus,
    number
  >;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_fulfilment_counts');

  if (error) {
    logger.error('myFulfilmentCounts failed', { cause: error.message });
    return counts;
  }

  const record = (data ?? {}) as Record<string, unknown>;
  for (const status of STATUSES) {
    counts[status] = asNumber(record[status]);
  }
  return counts;
}

export interface FulfilmentDetail {
  id: string;
  status: FulfilmentStatus;
  assignedAt: string | null;
  acceptedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  carrier: string | null;
  trackingCode: string | null;
  itemsSubtotalCents: number;
  merchantDueCents: number;
  orderNumber: string;
  placedAt: string;
  deliveryMethodName: string | null;
  items: { name: string; sku: string; quantity: number; unitPriceCents: number }[];
  /**
   * Released only once the fulfilment is assigned.
   *
   * Before that the merchant is one of several candidates on the routing screen and only one of them
   * will ever ship it — so the address is withheld by the function, not by this module (docs/16 §3).
   */
  shipTo: { name: string | null; phone: string | null; address: Record<string, unknown> } | null;
  codAmountCents: number;
}

/**
 * One fulfilment, or null.
 *
 * Null covers "not yours" and "does not exist" identically, because the function returns null for both
 * — a merchant probing another's id learns nothing from silence.
 */
export async function getMyFulfilment(id: string): Promise<FulfilmentDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_fulfilment_view', { p_fulfilment_id: id });

  if (error) {
    logger.error('getMyFulfilment failed', { cause: error.message });
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const payload = data as Record<string, unknown>;
  const fulfilment = (payload.fulfilment ?? {}) as Record<string, unknown>;
  const method = payload.delivery_method as Record<string, unknown> | null;
  const shipTo = payload.ship_to as Record<string, unknown> | null;

  const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];

  return {
    id: asText(fulfilment.id),
    status: toStatus(fulfilment.status),
    assignedAt: asNullableText(fulfilment.assigned_at),
    acceptedAt: asNullableText(fulfilment.accepted_at),
    packedAt: asNullableText(fulfilment.packed_at),
    shippedAt: asNullableText(fulfilment.shipped_at),
    carrier: asNullableText(fulfilment.carrier),
    trackingCode: asNullableText(fulfilment.tracking_code),
    itemsSubtotalCents: asNumber(fulfilment.items_subtotal_cents),
    merchantDueCents: asNumber(fulfilment.merchant_due_cents),
    orderNumber: asText(payload.order_number),
    placedAt: asText(payload.placed_at),
    deliveryMethodName: method ? asNullableText(method.name) : null,
    items: items.map((item) => ({
      name: asText(item.name),
      sku: asText(item.sku),
      quantity: asNumber(item.quantity),
      unitPriceCents: asNumber(item.unit_price_cents),
    })),
    shipTo: shipTo
      ? {
          name: asNullableText(shipTo.name),
          phone: asNullableText(shipTo.phone),
          address: (shipTo.address ?? {}) as Record<string, unknown>,
        }
      : null,
    codAmountCents: asNumber(payload.cod_amount_cents),
  };
}

/** What the dashboard needs: how many fulfilments are waiting on this merchant right now. */
export async function myOpenFulfilmentCount(): Promise<number> {
  const counts = await myFulfilmentCounts();
  return counts.assigned + counts.accepted + counts.packed;
}
