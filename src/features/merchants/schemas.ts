import { z } from 'zod';

/**
 * docs/16 §4 — the merchant application, and the admin decisions on it.
 *
 * Validated in one place for the public form, the server action and the admin review, so the three
 * cannot disagree about what a valid ARBK number or IBAN looks like.
 */

/**
 * Kosovo's ARBK business number.
 *
 * Deliberately loose: 8–12 digits, optionally prefixed. The registry has issued more than one format
 * over the years and rejecting a legitimate older number at the point of application would send a
 * real merchant away with no way to proceed — the document upload and the admin's own check are what
 * actually verify it. A regex here exists to catch a typed phone number, not to be the authority.
 */
const businessNo = z
  .string()
  .trim()
  .min(6, 'tooShort')
  .max(20, 'tooLong')
  .regex(/^[A-Za-z0-9-]+$/, 'invalid');

/**
 * IBAN, structurally only.
 *
 * Kosovo IBANs are `XK05` plus 16 digits, but a merchant may bank abroad, so the check is the
 * general shape: two letters, two check digits, 11–30 alphanumerics. The mod-97 checksum is not
 * verified — it would reject a valid IBAN typed with a transposed character *and* accept a
 * well-formed number belonging to somebody else, so it buys precision that does not matter here.
 * The first payout is the real test, and it is a manual bank transfer somebody watches.
 */
const iban = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/, 'invalid'));

const phone = z.string().trim().min(6, 'tooShort').max(32, 'tooLong');

export const merchantApplicationSchema = z.object({
  legalName: z.string().trim().min(2, 'required').max(160),
  displayName: z.string().trim().min(2, 'required').max(80),
  businessNo,
  vatNo: z.string().trim().max(32).optional().or(z.literal('')),

  contactName: z.string().trim().min(2, 'required').max(120),
  contactEmail: z.string().trim().toLowerCase().email('invalid').max(160),
  contactPhone: phone,

  addressLine: z.string().trim().min(3, 'required').max(200),
  city: z.string().trim().min(2, 'required').max(80),
  postalCode: z.string().trim().max(16).optional().or(z.literal('')),

  bankName: z.string().trim().min(2, 'required').max(120),
  iban,

  /** Free text: which categories they intend to sell, and roughly how much. */
  categories: z.string().trim().min(3, 'required').max(400),
  catalogSize: z.string().trim().max(80).optional().or(z.literal('')),

  /** True when the merchant imports rather than buying from a local distributor (docs/16 §4). */
  imports: z.coerce.boolean().optional(),

  /**
   * Both are required to submit, and both are checkboxes — so an unchecked box is `undefined` and
   * `z.literal(true)` is the only shape that refuses it. `coerce.boolean()` would turn `undefined`
   * into `false` and pass, which is exactly the wrong direction for an acceptance.
   */
  acceptsTerms: z.literal('on', { message: 'required' }),
  acceptsCommission: z.literal('on', { message: 'required' }),
});

export type MerchantApplication = z.infer<typeof merchantApplicationSchema>;

/**
 * The admin's decision (docs/16 §4).
 *
 * Commission and the shipping arrangement are set **here**, at approval, because that is when the
 * commercial terms are agreed — not at application, where the merchant would be choosing their own,
 * and not later, where the merchant would have been live on a default nobody decided.
 */
export const approveMerchantSchema = z.object({
  merchantId: z.string().uuid(),
  commissionPct: z.coerce.number().min(0, 'range').max(100, 'range'),
  shippingBorneBy: z.enum(['biocode', 'merchant', 'customer']),
  shipsOwn: z.coerce.boolean().optional(),
  collectsCash: z.coerce.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});

export const rejectMerchantSchema = z.object({
  merchantId: z.string().uuid(),
  /** Required: a rejection with no reason is one the applicant cannot act on or appeal. */
  reason: z.string().trim().min(10, 'required').max(2000),
});

export const requestInfoSchema = z.object({
  merchantId: z.string().uuid(),
  note: z.string().trim().min(10, 'required').max(2000),
});

/**
 * A URL-safe slug from the display name.
 *
 * Generated rather than asked for. A merchant choosing its own slug is a merchant choosing part of
 * BioCode's URL namespace, and the first collision or the first attempt at `biocode-official` is a
 * conversation nobody wants to have. Uniqueness is enforced by the column; the action retries with
 * a suffix.
 */
export function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks so "Përparim" becomes "perparim" rather than losing the letter.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return base || 'merchant';
}
