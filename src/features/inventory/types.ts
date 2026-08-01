import type { Database } from '@/lib/supabase/database.types';

export type StockMovementType = Database['public']['Enums']['stock_movement_type'];

export const MOVEMENT_TYPES = [
  'received',
  'sale',
  'cancel_restock',
  'refund_restock',
  'adjustment',
] as const satisfies readonly StockMovementType[];

export function toMovementType(value: string | undefined): StockMovementType | undefined {
  return (MOVEMENT_TYPES as readonly string[]).includes(value ?? '')
    ? (value as StockMovementType)
    : undefined;
}

/** The three buckets `v_admin_inventory` computes. Filter values, not presentation. */
export const STOCK_STATUSES = ['ok', 'low', 'out'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export function toStockStatus(value: string | undefined): StockStatus | undefined {
  return (STOCK_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as StockStatus)
    : undefined;
}

export interface InventoryRow {
  variantId: string;
  warehouseId: string;
  warehouseName: string;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
  productSlug: string;
  onHand: number;
  threshold: number;
  status: StockStatus;
  updatedAt: string;
}

export interface MovementRow {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  warehouseName: string;
  type: StockMovementType;
  quantity: number;
  batchNumber: string | null;
  expiryDate: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}
