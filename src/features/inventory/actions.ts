'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import {
  adjustStockSchema,
  receiveStockSchema,
  thresholdSchema,
} from '@/features/inventory/schemas';

/**
 * docs/06 §8 — receive stock, adjust stock, set a threshold.
 *
 * Every stock change goes through `apply_stock_movement`, which writes the ledger row and moves
 * `on_hand` in one statement. Nothing here updates `inventory_levels.on_hand` directly, and that
 * is the whole point: docs/13 §A7 records that an opening balance written straight into the
 * table broke the ledger invariant on day one, and `v_stock_ledger_drift` exists to catch a
 * repeat. The RPC is the only sanctioned writer, so this file cannot be the one that drifts.
 *
 * The threshold is the exception, and legitimately so — it is a *setting*, not a quantity. It
 * has no movement to record because no stock moved.
 */

export type InventoryErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.inventory.errors.checkFields'
  | 'admin.inventory.errors.insufficient'
  | 'admin.inventory.errors.notFound';

export type InventoryState = ActionResult<
  { onHand?: number },
  InventoryErrorKey
> | null;

/** Purges the storefront's view of availability after a movement. */
function purgeStorefront(): void {
  // Availability is rendered on the PDP and on every card that shows "out of stock", so the
  // whole product tag goes rather than one slug: a single receive can flip a product from
  // unavailable to buyable in a listing the operator never opened.
  revalidatePublic([CACHE_TAGS.products]);
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/movements');
}

/**
 * Maps the RPC's named exceptions onto message keys.
 *
 * `apply_stock_movement` raises `INSUFFICIENT_STOCK` when an adjustment would take `on_hand`
 * below zero — docs/06 §8's "negative adjustments cannot take on-hand < 0". The CHECK constraint
 * would also catch it, but with a message no operator can act on.
 */
function mapStockError(message: string): InventoryErrorKey {
  if (message.includes('INSUFFICIENT_STOCK')) return 'admin.inventory.errors.insufficient';
  if (message.includes('FORBIDDEN')) return 'admin.errors.forbidden';
  return 'admin.errors.generic';
}

export async function receiveStock(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const gate = await requireCapability('inventory.manage');
  if (!gate.ok) return fail<InventoryErrorKey, { onHand?: number }>(gate.error);

  const parsed = receiveStockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<InventoryErrorKey, { onHand?: number }>(
      'admin.inventory.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const { variantId, warehouseId, quantity, batchNumber, expiryDate, note } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('apply_stock_movement', {
      p_variant_id: variantId,
      p_warehouse_id: warehouseId,
      p_type: 'received',
      p_quantity: quantity,
      p_batch_number: batchNumber || undefined,
      p_expiry_date: expiryDate || undefined,
      p_note: note || undefined,
    });

    if (error) {
      logger.error('receiveStock failed', { cause: error.message, variantId });
      return fail<InventoryErrorKey, { onHand?: number }>(mapStockError(error.message));
    }

    await audit('inventory.receive', 'product_variant', variantId, null, {
      quantity,
      batchNumber: batchNumber || null,
      expiryDate: expiryDate || null,
      warehouseId,
    });

    purgeStorefront();
    return ok({});
  } catch (error) {
    logger.error('receiveStock threw', describeError(error));
    return fail<InventoryErrorKey, { onHand?: number }>('admin.errors.generic');
  }
}

export async function adjustStock(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const gate = await requireCapability('inventory.manage');
  if (!gate.ok) return fail<InventoryErrorKey, { onHand?: number }>(gate.error);

  const parsed = adjustStockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<InventoryErrorKey, { onHand?: number }>(
      'admin.inventory.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const { variantId, warehouseId, quantity, note } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('apply_stock_movement', {
      p_variant_id: variantId,
      p_warehouse_id: warehouseId,
      p_type: 'adjustment',
      p_quantity: quantity,
      p_note: note,
    });

    if (error) {
      logger.error('adjustStock failed', { cause: error.message, variantId });
      return fail<InventoryErrorKey, { onHand?: number }>(mapStockError(error.message));
    }

    await audit('inventory.adjust', 'product_variant', variantId, null, {
      quantity,
      note,
      warehouseId,
    });

    purgeStorefront();
    return ok({});
  } catch (error) {
    logger.error('adjustStock threw', describeError(error));
    return fail<InventoryErrorKey, { onHand?: number }>('admin.errors.generic');
  }
}

/**
 * The low-stock threshold — a setting, so it is written directly.
 *
 * `p_wh_write on inventory_levels` allows it, and no movement is recorded because no stock
 * moved. This is the one place in the feature that touches the table, and the `on_hand` column
 * is deliberately absent from the update.
 */
export async function setThreshold(
  _previous: InventoryState,
  formData: FormData,
): Promise<InventoryState> {
  const gate = await requireCapability('inventory.manage');
  if (!gate.ok) return fail<InventoryErrorKey, { onHand?: number }>(gate.error);

  const parsed = thresholdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<InventoryErrorKey, { onHand?: number }>(
      'admin.inventory.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const { variantId, warehouseId, threshold } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('inventory_levels')
      .update({ low_stock_threshold: threshold })
      .eq('variant_id', variantId)
      .eq('warehouse_id', warehouseId)
      .select('variant_id');

    if (error) {
      logger.error('setThreshold failed', { cause: error.message, variantId });
      return fail<InventoryErrorKey, { onHand?: number }>('admin.errors.generic');
    }
    if ((data ?? []).length === 0) {
      return fail<InventoryErrorKey, { onHand?: number }>('admin.inventory.errors.notFound');
    }

    await audit('inventory.threshold', 'product_variant', variantId, null, {
      threshold,
      warehouseId,
    });

    /*
     * The threshold changes what the storefront calls "low stock" (`v_product_stock` buckets on
     * it), so the catalogue tag goes too. Easy to miss — nothing about editing a number in an
     * admin table suggests a customer-facing page just changed.
     */
    purgeStorefront();
    return ok({});
  } catch (error) {
    logger.error('setThreshold threw', describeError(error));
    return fail<InventoryErrorKey, { onHand?: number }>('admin.errors.generic');
  }
}
