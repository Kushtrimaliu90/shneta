'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getMyMerchant } from '@/features/merchants/queries';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §5 — the details a merchant may change about itself.
 *
 * ── What is missing from this list, and why ──
 *
 * Not the legal name, the ARBK number, the commission, the shipping arrangement, or the status. Those
 * are either what BioCode verified at approval or what the two sides agreed commercially, and the
 * `guard_merchant_self_update` trigger refuses them at the database (§3) — so this schema omitting
 * them is a convenience for the form, not the protection. The protection is that a merchant sending
 * `commission_pct` in this payload gets an exception rather than a discount.
 *
 * The bank details *are* editable, and a change **writes an audit row**: a payout destination is the
 * one field on this form worth money, and "who changed the IBAN and when" is the first question
 * anybody asks after a payment goes to the wrong account. That trail is written by a database trigger
 * rather than here, for the same reason as everything else in §3 — a trigger cannot be bypassed by a
 * second code path.
 */

const schema = z.object({
  contactName: z.string().trim().min(2, 'required').max(120),
  contactPhone: z.string().trim().min(6, 'required').max(32),
  addressLine: z.string().trim().min(3, 'required').max(200),
  city: z.string().trim().min(2, 'required').max(80),
  postalCode: z.string().trim().max(16).optional().or(z.literal('')),
  /**
   * How BioCode settles. Switchable here, because a merchant who started on cash and opened a
   * business account should not have to reapply to be paid into it.
   */
  settlementMethod: z.enum(['bank_transfer', 'cash']).default('bank_transfer'),
  /** Required for a transfer, irrelevant for cash — enforced below, where the method is known. */
  bankName: z.string().trim().max(120).optional(),
  /**
   * The IBAN, optional on this form — an empty value means "leave it alone".
   *
   * The form cannot prefill it: the portal only ever holds the last four digits (see
   * `getMyMerchant`), so a prefilled field would either show a masked value the merchant would save
   * back as their real IBAN, or the full number on a screen in a shop. An empty field that means
   * "unchanged" is the only version of this that cannot corrupt the payout destination.
   */
  iban: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, '').toUpperCase())
    .refine((value) => value === '' || /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(value), 'invalid'),
});

export type ProfileErrorKey =
  | 'merchant.settings.errors.generic'
  | 'merchant.settings.errors.invalid'
  | 'merchant.settings.errors.notMerchant'
  | 'merchant.settings.errors.locked'
  | 'merchant.settings.errors.bankRequired';

export type ProfileState = ActionResult<{ saved: true }, ProfileErrorKey> | null;

export async function updateMerchantProfile(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const merchant = await getMyMerchant();
  if (!merchant) {
    return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.notMerchant');
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.invalid');
  }
  const input = parsed.data;

  /*
   * Whether the bank details are sufficient cannot be decided by the schema alone.
   *
   * An empty IBAN on this form means "leave it alone" — the portal only ever holds the last four
   * digits, so it cannot prefill the field — which makes "is there an IBAN?" a question about the
   * *stored* row rather than the submitted one. A merchant already on bank transfer may therefore
   * save with the field blank; a merchant switching **to** bank transfer with nothing on file may
   * not. `ibanLast4` is the portal's only view of it, and null there means no IBAN exists.
   */
  if (input.settlementMethod === 'bank_transfer') {
    const hasIban = Boolean(input.iban) || Boolean(merchant.ibanLast4);
    const hasBankName = (input.bankName ?? '').trim().length >= 2;
    if (!hasIban || !hasBankName) {
      return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.bankRequired');
    }
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('merchants')
      .update({
        contact_name: input.contactName,
        contact_phone: input.contactPhone,
        settlement_method: input.settlementMethod,
        address: {
          line1: input.addressLine,
          city: input.city,
          postal_code: input.postalCode || null,
          country_code: 'XK',
        } as unknown as Json,
        /*
         * Both bank fields follow the same rule: written only when the form actually supplied one.
         *
         * For the IBAN that is the pre-existing "empty means leave it alone" contract — see the note
         * on the field. For the bank name it is what makes switching reversible: choosing cash
         * unmounts both inputs, so neither key reaches the FormData, and blanking them on that basis
         * would silently discard details the merchant has to retype the day they switch back. Cash
         * simply stops the details being *used*; it is not an instruction to forget them.
         *
         * Spread rather than a mutable `patch` object, because the generated update type rejects an
         * index signature: it checks for excess properties, and `Record<string, unknown>` could carry
         * any of the columns the self-update guard exists to refuse. Building the literal keeps that
         * check working.
         */
        ...(input.bankName?.trim() ? { bank_name: input.bankName.trim() } : {}),
        ...(input.iban ? { iban: input.iban } : {}),
      })
      .eq('id', merchant.id)
      .select('id')
      .maybeSingle();

    if (error) {
      // The self-update guard's refusal, if a field ever slips into the patch that should not be.
      if (error.message.includes('MERCHANT_FIELD_FORBIDDEN')) {
        return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.locked');
      }
      logger.error('updateMerchantProfile failed', { cause: error.message });
      return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.generic');
    }
    if (!data) return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.locked');

    revalidatePath('/merchant/settings');
    revalidatePath('/merchant');
    return ok({ saved: true as const });
  } catch (error) {
    logger.error('updateMerchantProfile threw', describeError(error));
    return fail<ProfileErrorKey, { saved: true }>('merchant.settings.errors.generic');
  }
}
