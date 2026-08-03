'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { periodToSettle } from '@/features/merchants/payout-period';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §8 — building and paying.
 *
 * Both behind `payouts.manage`, which docs/01 §3 gives to **admin alone**. Routing is operational and
 * support can do it; moving money to a third party's bank account is not, and the SQL functions enforce
 * the same thing independently so a future cron or script cannot route around this file.
 *
 * Building and paying are separate actions on purpose. They are done by different people at different
 * times — a statement is cut on a schedule, a transfer happens when somebody is at a banking screen —
 * and a function that did both would mean a statement could only exist once the money had moved.
 */

export type PayoutErrorKey =
  | 'admin.errors.forbidden'
  | 'payouts.errors.generic'
  | 'payouts.errors.invalid'
  | 'payouts.errors.referenceRequired'
  | 'payouts.errors.notPayable'
  | 'payouts.errors.nothingToSettle';

export type PayoutState = ActionResult<{ built?: number; payoutId?: string }, PayoutErrorKey> | null;

function no(error: PayoutErrorKey): PayoutState {
  return fail<PayoutErrorKey, { built?: number; payoutId?: string }>(error);
}

const runSchema = z.object({
  /** Both optional: absent means "the fortnight that just closed", which is the normal case. */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const paySchema = z.object({
  payoutId: z.string().uuid(),
  reference: z.string().trim().min(3, 'required').max(120),
});

/**
 * Builds the run for a period.
 *
 * The period defaults to whatever `periodToSettle` says for today, so the ordinary case is one click
 * with nothing to type — and the dates are still explicit arguments to the SQL, so a run is always
 * recorded against the period it settled rather than against "when somebody pressed the button".
 */
export async function buildPayoutRun(
  _previous: PayoutState,
  formData: FormData,
): Promise<PayoutState> {
  const gate = await requireCapability('payouts.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = runSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('payouts.errors.invalid');

  const fallback = periodToSettle(new Date());
  const periodStart = parsed.data.periodStart ?? fallback.start;
  const periodEnd = parsed.data.periodEnd ?? fallback.end;

  if (periodEnd < periodStart) return no('payouts.errors.invalid');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('build_all_merchant_payouts', {
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });

    if (error) {
      logger.error('buildPayoutRun failed', { cause: error.message });
      return no(error.message.includes('FORBIDDEN') ? 'admin.errors.forbidden' : 'payouts.errors.generic');
    }

    const result = (data ?? {}) as { payouts?: { merchant_id: string; net_cents: number }[] };
    const payouts = result.payouts ?? [];

    await audit('payout.run', 'merchant_payout', null, null, {
      period_start: periodStart,
      period_end: periodEnd,
      built: payouts.length,
      total_net_cents: payouts.reduce((sum, entry) => sum + entry.net_cents, 0),
    } as unknown as Json);

    revalidatePath('/admin/payouts');
    revalidatePath('/merchant/payouts');

    if (payouts.length === 0) return no('payouts.errors.nothingToSettle');
    return ok({ built: payouts.length });
  } catch (error) {
    logger.error('buildPayoutRun threw', describeError(error));
    return no('payouts.errors.generic');
  }
}

/**
 * Records that a transfer happened.
 *
 * The reference is required by the SQL as well as by this schema, and that is not duplication for its
 * own sake: a payout marked paid with nothing to trace it by is where every reconciliation argument
 * starts, and the constraint has to hold for a script as well as for this form.
 */
export async function markPayoutPaid(
  _previous: PayoutState,
  formData: FormData,
): Promise<PayoutState> {
  const gate = await requireCapability('payouts.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = paySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('payouts.errors.referenceRequired');

  const { payoutId, reference } = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('mark_payout_paid', {
      p_payout_id: payoutId,
      p_reference: reference,
    });

    if (error) {
      if (error.message.includes('REFERENCE_REQUIRED')) return no('payouts.errors.referenceRequired');
      if (error.message.includes('PAYOUT_NOT_PAYABLE')) return no('payouts.errors.notPayable');
      if (error.message.includes('FORBIDDEN')) return no('admin.errors.forbidden');
      logger.error('markPayoutPaid failed', { cause: error.message });
      return no('payouts.errors.generic');
    }

    await audit('payout.paid', 'merchant_payout', payoutId, null, {
      reference,
    } as unknown as Json);

    revalidatePath('/admin/payouts');
    revalidatePath('/merchant/payouts');
    return ok({ payoutId });
  } catch (error) {
    logger.error('markPayoutPaid threw', describeError(error));
    return no('payouts.errors.generic');
  }
}

/**
 * A manual adjustment against a merchant's balance.
 *
 * Every marketplace needs one: a goodwill credit, a courier charge somebody agreed to absorb, a
 * correction to a mistake nobody can undo because the ledger is append-only. **A note is required** —
 * an adjustment without a reason is indistinguishable from a mistake three months later, and it is the
 * one row on a statement a merchant will definitely ask about.
 */
export async function postAdjustment(
  _previous: PayoutState,
  formData: FormData,
): Promise<PayoutState> {
  const gate = await requireCapability('payouts.manage');
  if (!gate.ok) return no('admin.errors.forbidden');

  const schema = z.object({
    merchantId: z.string().uuid(),
    /** Euro, signed: negative takes money off the merchant, positive credits it. */
    amountEuro: z
      .string()
      .trim()
      .min(1, 'required')
      .transform((value) => Number(value.replace(',', '.')))
      .refine((value) => Number.isFinite(value) && value !== 0 && Math.abs(value) <= 100_000, 'range')
      .transform((euro) => Math.round(euro * 100)),
    note: z.string().trim().min(5, 'required').max(500),
  });

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('payouts.errors.invalid');

  const { merchantId, amountEuro, note } = parsed.data;

  try {
    const supabase = await createClient();

    /*
     * A direct insert, unlike everything else in this file. There is no function to call: an adjustment
     * has no arithmetic to own — it is a number a person decided — and `p_admin_write` on
     * `merchant_ledger` is admin-only, which is the same gate this action already passed.
     */
    const { data, error } = await supabase
      .from('merchant_ledger')
      .insert({
        merchant_id: merchantId,
        kind: 'adjustment',
        amount_cents: amountEuro,
        note,
        created_by: gate.actor.id,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('postAdjustment failed', { cause: error.message });
      return no('payouts.errors.generic');
    }
    if (!data) return no('payouts.errors.generic');

    await audit('payout.adjustment', 'merchant', merchantId, null, {
      amount_cents: amountEuro,
      note,
    } as unknown as Json);

    revalidatePath('/admin/payouts');
    revalidatePath('/merchant/payouts');
    return ok({});
  } catch (error) {
    logger.error('postAdjustment threw', describeError(error));
    return no('payouts.errors.generic');
  }
}
