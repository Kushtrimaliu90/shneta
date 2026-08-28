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
export const IBAN_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;

/**
 * IBAN as entered — normalised, not yet required.
 *
 * Whether it is mandatory depends on the settlement method, which is a cross-field question and so
 * belongs in `superRefine` rather than here. What this still does unconditionally is normalise
 * spacing and case, and it stays `optional()` because the field is not rendered at all for a merchant
 * settling in cash and therefore never reaches the FormData.
 */
const ibanInput = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .optional();

/**
 * How BioCode settles with the merchant.
 *
 * `bank_transfer` is the default and stays the common case; a missing field means transfer rather
 * than an error, so an older client or a curl post cannot accidentally create a cash merchant.
 */
const settlementMethod = z.enum(['bank_transfer', 'cash']).default('bank_transfer');

/**
 * Bank details are required for a transfer and irrelevant for cash — and an IBAN that *is* supplied
 * must be well-formed either way, because a merchant who types one into the cash flow has told us
 * something and storing it malformed helps nobody.
 *
 * Shared by the application and the settings form so the two cannot drift into disagreeing about
 * when an account number is needed.
 */
export function checkSettlementDetails(
  value: { settlementMethod?: 'bank_transfer' | 'cash'; bankName?: string; iban?: string },
  ctx: z.RefinementCtx,
): void {
  const iban = (value.iban ?? '').trim();
  const bankName = (value.bankName ?? '').trim();

  if (iban && !IBAN_PATTERN.test(iban)) {
    ctx.addIssue({ code: 'custom', path: ['iban'], message: 'invalid' });
  }

  if ((value.settlementMethod ?? 'bank_transfer') !== 'bank_transfer') return;

  if (!iban) ctx.addIssue({ code: 'custom', path: ['iban'], message: 'required' });
  if (bankName.length < 2)
    ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'required' });
}

const phone = z.string().trim().min(6, 'tooShort').max(32, 'tooLong');

export const merchantApplicationSchema = z
  .object({
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

    /*
     * Settlement. Bank details are conditionally required — see `checkSettlementDetails` on the
     * `superRefine` below — because a merchant settling in cash has no account to give us and being
     * asked for one is the form telling them they are the wrong sort of applicant.
     */
    settlementMethod,
    bankName: z.string().trim().max(120).optional(),
    iban: ibanInput,

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
  })
  .superRefine(checkSettlementDetails);

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

/**
 * The admin editing a merchant's settlement details, at any point in their life (docs/16 §8).
 *
 * Separate from `approveMerchantSchema` because these are not approval-time decisions. A merchant
 * opens a new account, an IBAN was mistyped on the application, a cash merchant asks to be paid by
 * transfer — all of them happen to merchants who were approved months earlier, and none of them
 * should require re-running an approval.
 *
 * **A blank IBAN means "leave it alone", exactly as on the merchant's own settings form.** The admin
 * screen only ever renders the last four digits, so there is nothing safe to prefill the field with,
 * and a blank that meant "clear it" would let someone wipe a payout destination by saving a form they
 * only opened to fix a bank name.
 */
export const merchantSettlementSchema = z
  .object({
    merchantId: z.uuid(),
    settlementMethod,
    bankName: z.string().trim().max(120).optional(),
    iban: ibanInput,
    /** Whether the stored row already has an IBAN, so "leave it alone" can be a valid answer. */
    hasIbanOnFile: z.coerce.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const iban = (value.iban ?? '').trim();

    if (iban && !IBAN_PATTERN.test(iban)) {
      ctx.addIssue({ code: 'custom', path: ['iban'], message: 'invalid' });
    }
    if (value.settlementMethod !== 'bank_transfer') return;

    if (!iban && !value.hasIbanOnFile) {
      ctx.addIssue({ code: 'custom', path: ['iban'], message: 'required' });
    }
    if ((value.bankName ?? '').trim().length < 2) {
      ctx.addIssue({ code: 'custom', path: ['bankName'], message: 'required' });
    }
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
