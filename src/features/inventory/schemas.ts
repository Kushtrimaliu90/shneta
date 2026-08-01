import { z } from 'zod';

/**
 * docs/06 §8 — receive, adjust, threshold.
 *
 * Quantities are integers with an upper bound. The bound is not defensive theatre: the field is
 * a free-text number in a warehouse, `50000` is a plausible typo for `5000`, and the difference
 * between the two is a stock figure nobody notices is wrong until the shelf is empty.
 */

const targetSchema = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
});

export const receiveStockSchema = targetSchema.extend({
  quantity: z.coerce.number().int().min(1, 'Enter at least 1.').max(100_000),
  batchNumber: z.string().trim().max(60).optional().or(z.literal('')),
  /*
   * Expiry is optional but validated when present. A supplement without a date is ordinary —
   * not every SKU carries one — while `2026-13-01` is a typo that would otherwise be stored and
   * silently never expire.
   */
  expiryDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker.')
    .optional()
    .or(z.literal('')),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

export const adjustStockSchema = targetSchema.extend({
  /*
   * Signed, and zero is refused: "adjust by 0" is always a mis-click, and writing it would put
   * a meaningless row in an append-only ledger that can never be cleaned up.
   */
  quantity: z.coerce
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, 'Enter a positive or negative amount.'),
  // docs/06 §8: "reason mandatory". An unexplained adjustment is the one ledger row that makes
  // the whole ledger untrustworthy six months later.
  note: z.string().trim().min(3, 'Say why — this is the only record of it.').max(500),
});

export const thresholdSchema = targetSchema.extend({
  threshold: z.coerce.number().int().min(0).max(10_000),
});

export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
