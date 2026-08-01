import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { pickLocaleFrom } from '@/lib/i18n';
import { logger } from '@/lib/logger';
import {
  toMovementType,
  type InventoryRow,
  type MovementRow,
  type StockMovementType,
  type StockStatus,
} from '@/features/inventory/types';

/**
 * docs/06 §8 — inventory reads.
 *
 * Everything goes through the SSR client so `p_staff_read on inventory_levels` and
 * `p_wh_read on stock_movements` decide what comes back. The views are `security_invoker`, so
 * they inherit those policies rather than bypassing them — which is why they can be granted to
 * `authenticated` without granting anything.
 *
 * Product and variant names are read as raw jsonb and localized to `sq` here. The admin panel
 * is English-only (docs/01 §3), but a *product* has no English name until someone writes one,
 * and an inventory table full of blanks is worse than one showing the Albanian name. `pickLocale`
 * already falls back that way.
 */

export const MOVEMENTS_PAGE_SIZE = 50;

interface RawInventoryRow {
  variant_id: string;
  warehouse_id: string;
  warehouse_name: string;
  sku: string;
  variant_name: unknown;
  product_id: string;
  product_name: unknown;
  product_slug: string;
  on_hand: number;
  low_stock_threshold: number;
  stock_status: string;
  updated_at: string;
}

export interface InventoryFilters {
  status?: StockStatus;
  search?: string;
}

/**
 * The stock table.
 *
 * Not paginated. A catalogue that needs pagination here is a catalogue with more than a few
 * hundred variants, and at that size the screen an operator actually wants is the low-stock
 * filter — which is a tab, not a page two. Revisit when `products` passes ~500 rows.
 */
export async function listInventory(filters: InventoryFilters = {}): Promise<InventoryRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('v_admin_inventory')
    .select(
      `variant_id, warehouse_id, warehouse_name, sku, variant_name, product_id, product_name,
       product_slug, on_hand, low_stock_threshold, stock_status, updated_at`,
    )
    // Lowest stock first: the rows an operator came here to act on are the ones at the top.
    .order('on_hand', { ascending: true })
    .order('sku', { ascending: true });

  if (filters.status) query = query.eq('stock_status', filters.status);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`sku.ilike.${term},product_name->>sq.ilike.${term}`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('listInventory failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as RawInventoryRow[]).map((row) => ({
    variantId: row.variant_id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    sku: row.sku,
    // Also jsonb. Typing it `string` compiled fine and rendered as "[object Object]" at best —
    // in React 19 it throws "Objects are not valid as a React child" and takes the page down.
    variantName: pickLocaleFrom(row.variant_name, 'sq'),
    productId: row.product_id,
    productName: pickLocaleFrom(row.product_name, 'sq'),
    productSlug: row.product_slug,
    onHand: row.on_hand,
    threshold: row.low_stock_threshold,
    status: (['ok', 'low', 'out'] as const).find((s) => s === row.stock_status) ?? 'ok',
    updatedAt: row.updated_at,
  }));
}

/** Counts for the status tabs, in one round trip rather than three. */
export async function countInventoryByStatus(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('v_admin_inventory').select('stock_status');

  if (error) {
    logger.error('countInventoryByStatus failed', { cause: error.message });
    return { all: 0 };
  }

  const counts: Record<string, number> = { all: (data ?? []).length };
  for (const row of (data ?? []) as { stock_status: string }[]) {
    counts[row.stock_status] = (counts[row.stock_status] ?? 0) + 1;
  }
  return counts;
}

/** The variants a receive/adjust dialog can choose from, with their current level. */
export async function listStockTargets(): Promise<
  { variantId: string; warehouseId: string; label: string; onHand: number }[]
> {
  const rows = await listInventory();
  return rows.map((row) => ({
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    label: `${row.sku} · ${row.productName}${row.variantName ? ` (${row.variantName})` : ''}`,
    onHand: row.onHand,
  }));
}

export interface MovementFilters {
  variantId?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
  /** Keyset cursor: the `created_at` of the last row on the previous page. */
  before?: string;
}

interface RawMovementRow {
  id: string;
  variant_id: string;
  type: string;
  quantity: number;
  batch_number: string | null;
  expiry_date: string | null;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_at: string;
  product_variants: { sku: string; products: { name: unknown } | null } | null;
  warehouses: { name: string } | null;
  profiles: { email: string } | null;
}

/**
 * docs/06 §8 — the movements ledger.
 *
 * Keyset-paginated on `created_at` like the orders list, not `range()`: this table only grows,
 * and an offset page 40 gets slower every week while a cursor does not.
 */
export async function listMovements(
  filters: MovementFilters = {},
): Promise<{ rows: MovementRow[]; nextCursor: string | null }> {
  const supabase = await createClient();

  let query = supabase
    .from('stock_movements')
    .select(
      `id, variant_id, type, quantity, batch_number, expiry_date, reference_type, reference_id,
       note, created_at,
       product_variants ( sku, products ( name ) ),
       warehouses ( name ),
       profiles ( email )`,
    )
    .order('created_at', { ascending: false })
    .limit(MOVEMENTS_PAGE_SIZE + 1);

  if (filters.variantId) query = query.eq('variant_id', filters.variantId);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.from) query = query.gte('created_at', filters.from);
  // Inclusive of the whole `to` day: an operator picking 5 August means "through the 5th".
  if (filters.to) query = query.lt('created_at', `${filters.to}T23:59:59.999Z`);
  if (filters.before) query = query.lt('created_at', filters.before);

  const { data, error } = await query;

  if (error) {
    logger.error('listMovements failed', { cause: error.message });
    return { rows: [], nextCursor: null };
  }

  const raw = (data ?? []) as unknown as RawMovementRow[];
  const hasMore = raw.length > MOVEMENTS_PAGE_SIZE;
  const page = hasMore ? raw.slice(0, MOVEMENTS_PAGE_SIZE) : raw;

  const rows: MovementRow[] = page.map((row) => ({
    id: row.id,
    variantId: row.variant_id,
    sku: row.product_variants?.sku ?? '—',
    productName: pickLocaleFrom(row.product_variants?.products?.name, 'sq'),
    warehouseName: row.warehouses?.name ?? '—',
    type: toMovementType(row.type) ?? 'adjustment',
    quantity: row.quantity,
    batchNumber: row.batch_number,
    expiryDate: row.expiry_date,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    note: row.note,
    actorEmail: row.profiles?.email ?? null,
    createdAt: row.created_at,
  }));

  return {
    rows,
    nextCursor: hasMore ? (rows[rows.length - 1]?.createdAt ?? null) : null,
  };
}

/**
 * docs/09 §1 — the ledger invariant, read from the panel rather than only from the test suite.
 *
 * `v_stock_ledger_drift` returns one row per variant whose `on_hand` disagrees with the sum of
 * its movements. Every row is a bug, so the movements page shows the count when it is not zero
 * instead of leaving the check to a suite nobody runs at 3pm on a Tuesday.
 */
export async function countLedgerDrift(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('v_stock_ledger_drift')
    .select('variant_id', { count: 'exact', head: true });

  if (error) {
    logger.error('countLedgerDrift failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}
