'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { toCents } from '@/lib/money';

/**
 * docs/06 §11 — coupons.
 *
 * Admin-only writes (`coupons.manage` has an empty role list, so only admin passes `can()`), and
 * `p_admin_write on coupons` says the same thing in SQL. Support can read the list — enough to
 * answer "is this code real and why did it not apply" — and cannot mint one.
 */

export type CouponErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.coupons.errors.checkFields'
  | 'admin.coupons.errors.codeTaken'
  | 'admin.coupons.errors.systemLocked'
  | 'admin.coupons.errors.notFound';

export type CouponState = ActionResult<{ id?: string }, CouponErrorKey> | null;

function couponFail(error: CouponErrorKey): CouponState {
  return fail<CouponErrorKey, { id?: string }>(error);
}

/**
 * Percentage values are whole percents; fixed values are euros in the form and cents in the
 * database. Keeping the two apart in the schema rather than in the component means the action
 * cannot be fooled by a form that posts `10` meaning ten euros into a percentage coupon.
 */
const couponSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal('')),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, 'At least three characters.')
      .max(32)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Letters, numbers and hyphens only.'),
    type: z.enum(['percentage', 'fixed', 'free_shipping']),
    value: z.string().trim().optional().or(z.literal('')),
    minSubtotal: z.string().trim().optional().or(z.literal('')),
    maxUses: z.string().trim().optional().or(z.literal('')),
    maxUsesPerUser: z.string().trim().optional().or(z.literal('')),
    startsAt: z.string().trim().optional().or(z.literal('')),
    endsAt: z.string().trim().optional().or(z.literal('')),
    isActive: z.string().optional(),
    note: z.string().trim().max(300).optional().or(z.literal('')),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'percentage') {
      const percent = Number(data.value);
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'A whole percent from 1 to 100.',
        });
      }
    }
    if (data.type === 'fixed') {
      const cents = data.value ? toCents(data.value) : 0;
      if (!Number.isFinite(cents) || cents < 1) {
        ctx.addIssue({ code: 'custom', path: ['value'], message: 'An amount like 5.00.' });
      }
    }
    if (data.startsAt && data.endsAt && data.endsAt < data.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end is before the start.' });
    }
  });

/** Euros-or-blank → cents-or-null, in one place so three call sites cannot disagree. */
function optionalCents(value: string | undefined): number | null {
  if (!value) return null;
  const cents = toCents(value);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

function optionalInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function saveCoupon(_previous: CouponState, formData: FormData): Promise<CouponState> {
  const gate = await requireCapability('coupons.manage');
  if (!gate.ok) return couponFail(gate.error);

  const parsed = couponSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<CouponErrorKey, { id?: string }>(
      'admin.coupons.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const id = input.id || undefined;

  const value =
    input.type === 'percentage'
      ? Number(input.value)
      : input.type === 'fixed'
        ? toCents(input.value ?? '0')
        : 0;

  const patch = {
    code: input.code,
    type: input.type,
    value,
    min_subtotal_cents: optionalCents(input.minSubtotal),
    max_uses: optionalInt(input.maxUses),
    max_uses_per_user: optionalInt(input.maxUsesPerUser),
    starts_at: input.startsAt ? `${input.startsAt}T00:00:00Z` : null,
    // Inclusive of the whole end day: an operator setting 31 August means the code works on it.
    ends_at: input.endsAt ? `${input.endsAt}T23:59:59Z` : null,
    is_active: input.isActive === 'on',
    note: input.note || null,
  };

  try {
    const supabase = await createClient();

    if (id) {
      const { data: existing } = await supabase
        .from('coupons')
        .select('code, is_system, is_active')
        .eq('id', id)
        .maybeSingle();

      if (!existing) return couponFail('admin.coupons.errors.notFound');

      /*
       * System coupons are off limits. `SUB-10` is looked up **by code** by the subscription
       * engine, and `LOY-*` codes are minted per redemption — renaming or deactivating one
       * breaks a running feature in a way that surfaces days later as "renewals are full price".
       */
      if ((existing as { is_system: boolean }).is_system) {
        return couponFail('admin.coupons.errors.systemLocked');
      }

      const { error } = await supabase.from('coupons').update(patch).eq('id', id);

      if (error) {
        if (error.code === '23505') return couponFail('admin.coupons.errors.codeTaken');
        logger.error('saveCoupon update failed', { cause: error.message, id });
        return couponFail('admin.errors.generic');
      }

      await audit('coupon.update', 'coupon', id, existing, patch);
    } else {
      const { data, error } = await supabase.from('coupons').insert(patch).select('id').single();

      if (error) {
        if (error.code === '23505') return couponFail('admin.coupons.errors.codeTaken');
        logger.error('saveCoupon insert failed', { cause: error.message });
        return couponFail('admin.errors.generic');
      }

      await audit('coupon.create', 'coupon', (data as { id: string }).id, null, patch);
    }

    revalidatePath('/admin/coupons');
    /*
     * `/offers` lists claimable codes through `list_public_coupons()` (docs/13 §N4), and that
     * reader is cached under the products tag — so the tag to purge is the one the reader used,
     * not one named after the page. A tag with no reader is docs/13 §L4's cache purge that does
     * nothing.
     */
    revalidatePublic([CACHE_TAGS.products]);
    return ok({ id });
  } catch (error) {
    logger.error('saveCoupon threw', describeError(error));
    return couponFail('admin.errors.generic');
  }
}

/**
 * docs/06 §11 — "Deactivate ≠ delete once redeemed".
 *
 * There is no delete anywhere in this feature, redeemed or not. `coupon_redemptions` references
 * the coupon, and orders record `coupon_code` and `coupon_id`; removing the row would leave
 * historic orders with a discount whose origin cannot be explained. Deactivating stops it being
 * usable, which is the only thing anyone actually wants.
 */
export async function toggleCoupon(
  _previous: CouponState,
  formData: FormData,
): Promise<CouponState> {
  const gate = await requireCapability('coupons.manage');
  if (!gate.ok) return couponFail(gate.error);

  const id = String(formData.get('id') ?? '');
  const next = formData.get('isActive') === 'true';

  if (!z.string().uuid().safeParse(id).success) return couponFail('admin.errors.generic');

  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('coupons')
      .select('code, is_system')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return couponFail('admin.coupons.errors.notFound');
    if ((existing as { is_system: boolean }).is_system) {
      return couponFail('admin.coupons.errors.systemLocked');
    }

    const { error } = await supabase.from('coupons').update({ is_active: next }).eq('id', id);

    if (error) {
      logger.error('toggleCoupon failed', { cause: error.message, id });
      return couponFail('admin.errors.generic');
    }

    await audit('coupon.toggle', 'coupon', id, existing, { is_active: next });

    revalidatePath('/admin/coupons');
    revalidatePublic([CACHE_TAGS.products]);
    return ok({ id });
  } catch (error) {
    logger.error('toggleCoupon threw', describeError(error));
    return couponFail('admin.errors.generic');
  }
}
