'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';

/**
 * docs/06 §9 — the two mutations a support agent can make against a customer.
 *
 * Neither is a profile edit. Support cannot change a name, an email or an address from here,
 * and the absence is deliberate: the customer can change all three themselves in
 * `/account/settings`, and an agent editing them is how a phone call becomes a data-integrity
 * incident nobody can reconstruct. What support *can* do is move points, which requires a
 * reason, and erase the person, which requires being an admin.
 */

export type CustomerErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.customers.errors.checkFields'
  | 'admin.customers.errors.notFound'
  | 'admin.customers.errors.insufficientPoints'
  | 'admin.customers.errors.staffProtected'
  | 'admin.customers.errors.confirmMismatch';

export type CustomerState = ActionResult<{ balance?: number }, CustomerErrorKey> | null;

function customerFail(error: CustomerErrorKey): CustomerState {
  return fail<CustomerErrorKey, { balance?: number }>(error);
}

const adjustSchema = z.object({
  userId: z.string().uuid(),
  points: z.coerce
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((value) => value !== 0, 'Enter a positive or negative number of points.'),
  note: z.string().trim().min(3, 'Say why — the customer may ask.').max(300),
});

/**
 * A manual points adjustment (docs/06 §9).
 *
 * Through `admin_adjust_loyalty`, never a direct write: `loyalty_transactions` has no insert
 * policy, and `profiles.loyalty_points` is derived from it by trigger. The ledger row is the
 * adjustment; the balance is a consequence.
 */
export async function adjustLoyalty(
  _previous: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const gate = await requireCapability('customers.view');
  if (!gate.ok) return customerFail(gate.error);

  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<CustomerErrorKey, { balance?: number }>(
      'admin.customers.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const { userId, points, note } = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_adjust_loyalty', {
      p_user_id: userId,
      p_points: points,
      p_note: note,
    });

    if (error) {
      if (error.message.includes('INSUFFICIENT_POINTS')) {
        return customerFail('admin.customers.errors.insufficientPoints');
      }
      if (error.message.includes('CUSTOMER_NOT_FOUND')) {
        return customerFail('admin.customers.errors.notFound');
      }
      logger.error('adjustLoyalty failed', { cause: error.message, userId });
      return customerFail('admin.errors.generic');
    }

    const balance = (data as { balance?: number } | null)?.balance;

    await audit('customer.loyalty_adjust', 'profile', userId, null, { points, note, balance });

    revalidatePath(`/admin/customers/${userId}`);
    return ok({ balance });
  } catch (error) {
    logger.error('adjustLoyalty threw', describeError(error));
    return customerFail('admin.errors.generic');
  }
}

const anonymizeSchema = z.object({
  userId: z.string().uuid(),
  /*
   * Typing the email is the confirmation. A checkbox or a second "are you sure" dialog is
   * clicked through; retyping the address means the operator has read which account this is,
   * which is the only mistake that matters here — the action is irreversible.
   */
  confirmEmail: z.string().trim().min(1),
});

/**
 * docs/06 §9 — GDPR erasure. Admin only, irreversible.
 *
 * Two halves, and both have to happen:
 *
 *  1. `admin_anonymize_customer` scrubs the public schema in one transaction — profile,
 *     addresses, orders, subscriptions, newsletter.
 *  2. The **service client** scrubs the GoTrue identity, because `auth.users` is outside the
 *     RPC's schema and a security-definer function reaching into it is how a Supabase upgrade
 *     breaks erasure silently. This is service-role caller #7 in docs/02 §6.
 *
 * The auth user is not deleted. Eleven tables reference `profiles(id)` without `on delete`
 * behaviour (docs/13 §M9), so deletion fails at the FK and leaves the scrub half-done. Instead
 * the email is replaced and the password randomised: the account still exists, and nobody —
 * including the former owner — can sign into it or be identified by it.
 */
export async function anonymizeCustomer(
  _previous: CustomerState,
  formData: FormData,
): Promise<CustomerState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return customerFail(gate.error);

  const parsed = anonymizeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return customerFail('admin.customers.errors.checkFields');

  const { userId, confirmEmail } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, role')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) return customerFail('admin.customers.errors.notFound');

    const current = profile as { email: string; role: string };
    if (current.email.toLowerCase() !== confirmEmail.toLowerCase()) {
      return customerFail('admin.customers.errors.confirmMismatch');
    }

    const { data, error } = await supabase.rpc('admin_anonymize_customer', { p_user_id: userId });

    if (error) {
      if (error.message.includes('CANNOT_ANONYMISE_STAFF')) {
        return customerFail('admin.customers.errors.staffProtected');
      }
      if (error.message.includes('CUSTOMER_NOT_FOUND')) {
        return customerFail('admin.customers.errors.notFound');
      }
      logger.error('anonymizeCustomer failed', { cause: error.message, userId });
      return customerFail('admin.errors.generic');
    }

    const placeholder = (data as { placeholder_email?: string } | null)?.placeholder_email;

    if (placeholder) {
      const admin = createAdminClient();
      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        email: placeholder,
        password: randomUUID(),
        user_metadata: { full_name: null },
      });

      /*
       * Logged loudly rather than rolled back. The public schema is already scrubbed, so
       * retrying is safe and the remaining exposure is one row in GoTrue — but it IS still
       * exposure, so it must not pass silently as a success.
       */
      if (authError) {
        logger.error('Auth identity not scrubbed after anonymise', {
          userId,
          cause: authError.message,
        });
        await audit('customer.anonymise_partial', 'profile', userId, null, {
          reason: 'auth identity not scrubbed',
        });
        return customerFail('admin.errors.generic');
      }
    }

    await audit('customer.anonymise', 'profile', userId, { email: current.email }, data);

    revalidatePath('/admin/customers');
    revalidatePath(`/admin/customers/${userId}`);
    return ok({});
  } catch (error) {
    logger.error('anonymizeCustomer threw', describeError(error));
    return customerFail('admin.errors.generic');
  }
}
