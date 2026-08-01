import type { InventoryErrorKey } from '@/features/inventory/actions';
import type { StockMovementType, StockStatus } from '@/features/inventory/types';

/**
 * English strings for the inventory screens (the admin panel has no next-intl provider —
 * docs/01 §3). Keyed on the union so a new error key without a message is a compile error.
 */
export const INVENTORY_ERRORS: Record<InventoryErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.inventory.errors.checkFields': 'Check the fields marked below.',
  'admin.inventory.errors.insufficient':
    'That would take stock below zero. Check the count on the shelf first.',
  'admin.inventory.errors.notFound': 'That stock record no longer exists.',
};

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  ok: 'In stock',
  low: 'Low',
  out: 'Out of stock',
};

export const STOCK_STATUS_TONES: Record<StockStatus, string> = {
  ok: 'bg-success text-white',
  low: 'bg-warning text-white',
  out: 'bg-error text-white',
};

/**
 * Movement types as an operator reads them.
 *
 * "Sale" and the two restocks are written by the checkout and refund paths, never by a person —
 * they appear here because the ledger shows every row, and a type with no label reads as a bug.
 */
export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  received: 'Received',
  sale: 'Sold',
  cancel_restock: 'Restocked (cancelled)',
  refund_restock: 'Restocked (refund)',
  adjustment: 'Adjusted',
};
