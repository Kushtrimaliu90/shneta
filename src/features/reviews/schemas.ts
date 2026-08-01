import { z } from 'zod';

/** docs/02 §7 — one schema per mutation, shared by the action and its form. */

const uuid = z.string().uuid();

/**
 * docs/05 §3 — writing a review.
 *
 * The rating is the only required field. A one-tap five stars is a real review and the most
 * common one; demanding prose to go with it costs more reviews than the prose is worth.
 *
 * `orderId` is deliberately **not** here. `p_insert_own` (docs/13 §B3) requires an order that
 * belongs to the author and contains the product, so letting the client name one would be
 * asking the browser which purchase to credit. The action looks it up.
 */
export const createReviewSchema = z.object({
  productId: uuid,
  rating: z.coerce.number().int().min(1, 'RATING_REQUIRED').max(5),
  title: z.string().trim().max(120).optional().or(z.literal('')),
  body: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const voteReviewSchema = z.object({
  reviewId: uuid,
  /** Present when the reader has already voted — the same control un-votes. */
  voted: z.union([z.literal('true'), z.literal('')]).optional(),
});

export const moderateReviewSchema = z.object({
  reviewId: uuid,
  action: z.enum(['approve', 'reject', 'reply']),
  /** docs/06 §10 — a rejection reason is shown to the customer, so it is required. */
  reason: z.string().trim().max(500).optional().or(z.literal('')),
  reply: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const bulkApproveSchema = z.object({
  reviewIds: z.array(uuid).min(1).max(100),
});
