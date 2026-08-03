import { z } from 'zod';

/**
 * docs/16 §5 — what a merchant may say about an offer, and what a reviewer may decide about it.
 *
 * Split from `schemas.ts` (the application) because the two have different authors: an applicant
 * fills in the first once, and a merchant edits the second every week. Keeping them apart means the
 * offer form's rules can tighten without touching the onboarding path that is already in production.
 */

/**
 * The merchant's asking price, in cents.
 *
 * **Not the customer-facing price.** The canonical variant price is what the shopper pays whoever
 * holds the stock (docs/16 §1); this is what the merchant asks BioCode for the unit, and it is the
 * number the buy box sorts on and the reviewer weighs against what settlement would pay.
 *
 * Entered in euro and converted here, because a merchant typing `12.50` into a field labelled
 * "price" is not going to type `1250` — and a form that accepts euro but stores cents has to do the
 * conversion in exactly one place or produce hundred-fold errors.
 */
const priceEuro = z
  .string()
  .trim()
  .min(1, 'required')
  // Comma as the decimal separator, because that is how the number is written in Albanian.
  .transform((value) => Number(value.replace(',', '.')))
  /*
   * Refined after the conversion rather than piped into `z.coerce.number()`.
   *
   * `coerce` declares its input as `unknown`, so piping a `string` transform into it does not
   * typecheck under strict mode — and reaching for a cast to make it would defeat the point of having
   * the schema. `Number('')` is 0 and `Number('abc')` is NaN, both of which `positive()` would let
   * through as a number type, so the finite check is doing real work.
   */
  .refine((euro) => Number.isFinite(euro) && euro > 0 && euro <= 100_000, 'range')
  .transform((euro) => Math.round(euro * 100));

const stock = z.coerce.number().int('invalid').min(0, 'range').max(1_000_000, 'range');

/**
 * Handling days: how long the merchant takes to hand the parcel to the courier.
 *
 * Capped at 30 by the column, but the *marketplace* cap is `merchant_max_handling_days` in settings
 * and is enforced in the action rather than here — a schema that hard-coded 3 would need a deploy to
 * change a commercial policy.
 */
const handlingDays = z.coerce.number().int('invalid').min(0, 'range').max(30, 'range');

export const offerCreateSchema = z.object({
  variantId: z.string().uuid('required'),
  merchantSku: z.string().trim().max(64).optional().or(z.literal('')),
  priceEuro,
  stockOnHand: stock,
  lowStockThreshold: z.coerce.number().int('invalid').min(0, 'range').max(10_000, 'range'),
  handlingDays,
  /**
   * Whether to submit it for review straight away, as a checkbox — so absent means "save as draft".
   * The action decides the status; the form never posts one, because a form that posts a status is a
   * form that can post `approved`.
   */
  submitNow: z.literal('on').optional(),
});

export const offerUpdateSchema = z.object({
  offerId: z.string().uuid(),
  merchantSku: z.string().trim().max(64).optional().or(z.literal('')),
  priceEuro,
  stockOnHand: stock,
  lowStockThreshold: z.coerce.number().int('invalid').min(0, 'range').max(10_000, 'range'),
  handlingDays,
});

/** Stock on its own, for the inline field on the offers list. */
export const offerStockSchema = z.object({
  offerId: z.string().uuid(),
  stockOnHand: stock,
});

export const offerIdSchema = z.object({ offerId: z.string().uuid() });

/**
 * The reviewer's decision.
 *
 * `approved` and `rejected` are the reviewer's words and the merchant cannot write them — the
 * `guard_merchant_offer_write` trigger refuses, which is why this schema is the only place they
 * appear and why it lives behind `offers.review`.
 */
export const offerDecisionSchema = z.object({
  offerId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  /** Required on a rejection: an offer refused with no reason is one the merchant cannot fix. */
  note: z.string().trim().max(1000).optional(),
});

export type OfferCreateInput = z.infer<typeof offerCreateSchema>;
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;
