import { z } from 'zod';
import { MAX_CART_ITEM_QTY } from '@/lib/constants';
import { emailSchema, phoneSchema } from '@/features/auth/schemas';

/** docs/02 §7 — one schema per mutation, reused on both sides of the boundary. */

const uuid = z.string().uuid();

export const addToCartSchema = z.object({
  variantId: uuid,
  quantity: z.coerce.number().int().min(1).max(MAX_CART_ITEM_QTY).default(1),
  /**
   * docs/07 §8.1 — the subscribe intent, absent for a one-off purchase.
   *
   * Constrained to the four cadences the schema's CHECK also enforces, so a hand-edited form
   * value is rejected here with a sensible message rather than by a constraint violation.
   */
  subscribeFrequencyDays: z.coerce
    .number()
    .refine((value) => [30, 45, 60, 90].includes(value))
    .optional(),
});

export const updateQuantitySchema = z.object({
  lineId: uuid,
  /**
   * Zero is allowed and means remove. A stepper that hits 0 should delete the line rather
   * than fail validation — otherwise the UI has to special-case its own decrement button.
   */
  quantity: z.coerce.number().int().min(0).max(MAX_CART_ITEM_QTY),
});

export const removeLineSchema = z.object({ lineId: uuid });

export const couponCodeSchema = z.object({
  // citext in the DB, so case does not matter; trimmed because people paste with spaces.
  code: z.string().trim().min(2).max(64),
});

/** docs/05 §12 — the address form. Kosovo-shaped: postal code optional, country fixed. */
export const addressSchema = z.object({
  recipientName: z.string().trim().min(2, 'REQUIRED').max(120),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'REQUIRED').max(160),
  line2: z.string().trim().max(160).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'REQUIRED').max(80),
  postalCode: z.string().trim().max(16).optional().or(z.literal('')),
  countryCode: z.literal('XK').default('XK'),
});

export type AddressInput = z.infer<typeof addressSchema>;

/**
 * docs/05 §12 — the whole checkout in one schema.
 *
 * Billing defaults to the shipping address (`sameAsBilling`), which is what almost every
 * COD order wants; the RPC applies the same fallback server-side regardless.
 */
export const placeOrderSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  shipping: addressSchema,
  sameAsBilling: z.coerce.boolean().default(true),
  billing: addressSchema.optional(),
  shippingMethodId: uuid,
  // docs/07 §6 — `bank_pos` only appears once settings.checkout.bank_pos_enabled is true.
  paymentProvider: z.enum(['cod', 'bank_pos']).default('cod'),
  couponCode: z.string().trim().max(64).optional().or(z.literal('')),
  customerNote: z.string().trim().max(500).optional().or(z.literal('')),
  // docs/05 §12.4 — explicit terms acceptance before an order is placed.
  terms: z.literal('on', { message: 'TERMS_REQUIRED' }),
  saveAddress: z.coerce.boolean().default(false),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** docs/05 §13 — guest order lookup: number plus the email it was placed with. */
export const orderLookupSchema = z.object({
  orderNumber: z.string().trim().min(6).max(40),
  email: emailSchema,
});
