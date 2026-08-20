'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';
import { addressSchema } from '@/features/cart/schemas';
import { keepSubmitted } from '@/lib/keep-submitted';

/**
 * docs/05 §14 — the address book: create, edit, delete, set defaults.
 *
 * `addressSchema` is reused from checkout rather than redeclared. The two must agree — an address
 * saved here is offered at checkout, and a rule that holds in one place and not the other means
 * a saved address the checkout then rejects.
 *
 * Ownership is enforced by `p_own on addresses`, not here: every statement below is scoped to
 * `auth.uid()` by RLS, so a forged id touches zero rows. These actions only report whether
 * anything was written.
 */

export type AddressErrorKey =
  | 'account.addresses.errors.signedOut'
  | 'account.addresses.errors.checkFields'
  | 'account.addresses.errors.notFound'
  | 'account.addresses.errors.generic';

export type AddressState = ActionResult<{ id?: string }, AddressErrorKey> | null;

function addressFail(error: AddressErrorKey): AddressState {
  return fail<AddressErrorKey, { id?: string }>(error);
}

const saveSchema = addressSchema.extend({
  id: z.string().uuid().optional().or(z.literal('')),
  label: z.string().trim().max(40).optional().or(z.literal('')),
  isDefaultShipping: z.string().optional(),
  isDefaultBilling: z.string().optional(),
});

async function saveAddressImpl(_previous: AddressState, formData: FormData): Promise<AddressState> {
  const user = await getCurrentUser();
  if (!user) return addressFail('account.addresses.errors.signedOut');

  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<AddressErrorKey, { id?: string }>(
      'account.addresses.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const makeDefaultShipping = input.isDefaultShipping === 'on';
  const makeDefaultBilling = input.isDefaultBilling === 'on';

  const patch = {
    label: input.label || null,
    recipient_name: input.recipientName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2 || null,
    city: input.city,
    postal_code: input.postalCode || null,
    country_code: 'XK',
    is_default_shipping: makeDefaultShipping,
    is_default_billing: makeDefaultBilling,
  };

  try {
    const supabase = await createClient();

    /*
     * "Default" is exclusive, and nothing in the schema enforces that — there is no partial
     * unique index on `(user_id) where is_default_shipping`. So the previous default is cleared
     * first. Two defaults would make checkout's preselection arbitrary, which is the kind of bug
     * that only shows up as "it picked the wrong address again".
     */
    if (makeDefaultShipping) {
      await supabase
        .from('addresses')
        .update({ is_default_shipping: false })
        .eq('user_id', user.id);
    }
    if (makeDefaultBilling) {
      await supabase.from('addresses').update({ is_default_billing: false }).eq('user_id', user.id);
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('addresses')
        .update(patch)
        .eq('id', input.id)
        .select('id');

      if (error) {
        logger.error('saveAddress update failed', { cause: error.message });
        return addressFail('account.addresses.errors.generic');
      }
      if ((data ?? []).length === 0) return addressFail('account.addresses.errors.notFound');
    } else {
      /*
       * The first address a customer saves becomes both defaults, whatever the checkboxes say.
       * An address book where nothing is the default makes checkout preselect nothing, and the
       * customer retypes an address they have already given us.
       */
      const { count } = await supabase
        .from('addresses')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      const isFirst = (count ?? 0) === 0;

      const { error } = await supabase.from('addresses').insert({
        ...patch,
        user_id: user.id,
        is_default_shipping: makeDefaultShipping || isFirst,
        is_default_billing: makeDefaultBilling || isFirst,
      });

      if (error) {
        logger.error('saveAddress insert failed', { cause: error.message });
        return addressFail('account.addresses.errors.generic');
      }
    }

    revalidatePath('/account/addresses');
    revalidatePath('/checkout');
    return ok({ id: input.id || undefined });
  } catch (error) {
    logger.error('saveAddress threw', describeError(error));
    return addressFail('account.addresses.errors.generic');
  }
}

export const saveAddress = keepSubmitted(saveAddressImpl);

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Deletes an address.
 *
 * A real delete, not a soft one. Orders snapshot the address as jsonb at checkout
 * (`orders.shipping_address`), so removing the row cannot orphan an order — and an address book
 * that keeps everything you ever typed is a privacy problem the customer asked you to fix.
 */
export async function deleteAddress(
  _previous: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const user = await getCurrentUser();
  if (!user) return addressFail('account.addresses.errors.signedOut');

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return addressFail('account.addresses.errors.generic');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('addresses')
      .delete()
      .eq('id', parsed.data.id)
      .select('id, is_default_shipping');

    if (error) {
      logger.error('deleteAddress failed', { cause: error.message });
      return addressFail('account.addresses.errors.generic');
    }

    const deleted = (data ?? [])[0] as { id: string; is_default_shipping: boolean } | undefined;
    if (!deleted) return addressFail('account.addresses.errors.notFound');

    // Deleting the default promotes whatever is left, so the book never has no default.
    if (deleted.is_default_shipping) {
      const { data: next } = await supabase
        .from('addresses')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1);

      const promote = (next ?? [])[0] as { id: string } | undefined;
      if (promote) {
        await supabase
          .from('addresses')
          .update({ is_default_shipping: true, is_default_billing: true })
          .eq('id', promote.id);
      }
    }

    revalidatePath('/account/addresses');
    revalidatePath('/checkout');
    return ok({});
  } catch (error) {
    logger.error('deleteAddress threw', describeError(error));
    return addressFail('account.addresses.errors.generic');
  }
}

/** Makes one address the default for both shipping and billing. */
export async function setDefaultAddress(
  _previous: AddressState,
  formData: FormData,
): Promise<AddressState> {
  const user = await getCurrentUser();
  if (!user) return addressFail('account.addresses.errors.signedOut');

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return addressFail('account.addresses.errors.generic');

  try {
    const supabase = await createClient();

    await supabase
      .from('addresses')
      .update({ is_default_shipping: false, is_default_billing: false })
      .eq('user_id', user.id);

    const { data, error } = await supabase
      .from('addresses')
      .update({ is_default_shipping: true, is_default_billing: true })
      .eq('id', parsed.data.id)
      .select('id');

    if (error) {
      logger.error('setDefaultAddress failed', { cause: error.message });
      return addressFail('account.addresses.errors.generic');
    }
    if ((data ?? []).length === 0) return addressFail('account.addresses.errors.notFound');

    revalidatePath('/account/addresses');
    revalidatePath('/checkout');
    return ok({ id: parsed.data.id });
  } catch (error) {
    logger.error('setDefaultAddress threw', describeError(error));
    return addressFail('account.addresses.errors.generic');
  }
}
