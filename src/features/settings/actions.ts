'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { STAFF_ROLES, type UserRole } from '@/features/admin/roles';
import { toCents } from '@/lib/money';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §15 — settings, shipping methods and the team.
 *
 * Every write here changes the storefront, which is the property the milestone's acceptance
 * criterion turns on ("settings changes reflect on storefront"). The mechanism is the same one
 * the catalogue uses: the readers in `features/content/queries.ts` are `unstable_cache`d under
 * `CACHE_TAGS.settings` and `CACHE_TAGS.shipping`, and every action below purges the tag its
 * reader used. Forgetting that line is docs/13 §K1 all over again — the write lands, the
 * database is correct, and the shop keeps serving yesterday's VAT rate until the ISR window
 * expires.
 */

export type SettingsErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.settings.errors.checkFields'
  | 'admin.settings.errors.notFound'
  | 'admin.settings.errors.emailTaken'
  | 'admin.settings.errors.lastAdmin'
  | 'admin.settings.errors.noSubCoupon';

export type SettingsState = ActionResult<{ message?: string }, SettingsErrorKey> | null;

function settingsFail(error: SettingsErrorKey): SettingsState {
  return fail<SettingsErrorKey, { message?: string }>(error);
}

/** Writes one `settings` row and purges the tag the storefront reads it through. */
async function writeSetting(
  key: string,
  value: Record<string, unknown>,
  tags: readonly string[],
): Promise<SettingsState> {
  const supabase = await createClient();

  const { data: before } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value: value as Json, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );

  if (error) {
    logger.error('writeSetting failed', { key, cause: error.message });
    return settingsFail('admin.errors.generic');
  }

  await audit(`settings.${key}`, 'settings', null, before ?? null, value);

  revalidatePublic(tags);
  revalidatePath('/admin/settings');
  return ok({ message: 'Saved.' });
}

// -----------------------------------------------------------------------------
// Store
// -----------------------------------------------------------------------------

const storeSchema = z.object({
  name: z.string().trim().min(1, 'The shop needs a name.').max(60),
  email: z.string().trim().email('A valid address, like info@biocode.com.'),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  instagram: z
    .string()
    .trim()
    .url('A full address, starting with https://')
    .optional()
    .or(z.literal('')),
  tiktok: z
    .string()
    .trim()
    .url('A full address, starting with https://')
    .optional()
    .or(z.literal('')),
  facebook: z
    .string()
    .trim()
    .url('A full address, starting with https://')
    .optional()
    .or(z.literal('')),
  announcement: z.string().trim().max(160).optional().or(z.literal('')),
  opsEmail: z.string().trim().email('A valid email address').optional().or(z.literal('')),
});

export async function saveStoreSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = storeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  return writeSetting('store', parsed.data, [CACHE_TAGS.settings]);
}

// -----------------------------------------------------------------------------
// Tax
// -----------------------------------------------------------------------------

const taxSchema = z.object({
  rate: z.coerce.number().min(0).max(30),
});

/**
 * docs/06 §15 — the VAT rate. "Prices include VAT" is informational and locked on.
 *
 * Locked because it is not a setting, it is an architecture decision: `computeTotals` derives
 * the tax component *out of* a VAT-inclusive price (docs/07 §2), and flipping this would not
 * change a calculation, it would make every price in the catalogue mean something different.
 * The screen says so rather than offering a toggle that would silently mis-price the shop.
 */
export async function saveTaxSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = taxSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  return writeSetting('tax', { rate: parsed.data.rate }, [
    CACHE_TAGS.settings,
    CACHE_TAGS.products,
  ]);
}

// -----------------------------------------------------------------------------
// Payments
// -----------------------------------------------------------------------------

const paymentsSchema = z.object({
  codEnabled: z.string().optional(),
  bankPosEnabled: z.string().optional(),
  maxItemQty: z.coerce.number().int().min(1).max(100),
});

export async function savePaymentSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = paymentsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  return writeSetting(
    'checkout',
    {
      max_item_qty: parsed.data.maxItemQty,
      cod_enabled: parsed.data.codEnabled === 'on',
      bank_pos_enabled: parsed.data.bankPosEnabled === 'on',
    },
    [CACHE_TAGS.settings],
  );
}

// -----------------------------------------------------------------------------
// Loyalty and subscriptions
// -----------------------------------------------------------------------------

/*
 * docs/17 §0.1 — one point value replaces the old two-number conversion block.
 *
 * `pointValueCents` is what a point is worth and `minRedeemPoints` is the floor, in multiples of 100.
 * The old shape carried a rate in two fields that could contradict each other; this one cannot.
 */
const loyaltySchema = z.object({
  earnRate: z.coerce.number().min(0).max(100),
  pointValueCents: z.coerce.number().int().min(1).max(100),
  minRedeemPoints: z.coerce.number().int().min(100).max(100_000),
  subscriptionDiscountPct: z.coerce.number().int().min(0).max(90),
  noticeDays: z.coerce.number().int().min(0).max(30),
});

export async function saveLoyaltySettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = loyaltySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;

  /*
   * A multiple of 100, because `redeem_loyalty_points` refuses anything else — a minimum of 550 would
   * be a floor no redemption could ever sit exactly on, and the customer would see the button refuse a
   * balance the page told them was enough.
   */
  if (input.minRedeemPoints % 100 !== 0) {
    return fail<SettingsErrorKey, { message?: string }>('admin.settings.errors.checkFields', {
      minRedeemPoints: ['A multiple of 100.'],
    });
  }

  const supabase = await createClient();

  /*
   * The subscription discount is applied as the `SUB-<pct>` coupon, not as a number in the
   * pricing code (docs/13 §O4). Changing the percentage without minting the matching code stops
   * every renewal in the shop — the engine refuses to build an order it cannot discount. So the
   * coupon is checked here, before the setting is written, and the operator is told which code
   * to create rather than discovering it from a cron failure three days later.
   */
  if (input.subscriptionDiscountPct > 0) {
    const code = `SUB-${input.subscriptionDiscountPct}`;
    const { count } = await supabase
      .from('coupons')
      .select('id', { count: 'exact', head: true })
      .eq('code', code)
      .eq('is_active', true);

    if ((count ?? 0) === 0) return settingsFail('admin.settings.errors.noSubCoupon');
  }

  const loyalty = await writeSetting(
    'loyalty',
    {
      earn_points_per_eur: input.earnRate,
      point_value_cents: input.pointValueCents,
      min_redeem_points: input.minRedeemPoints,
    },
    [CACHE_TAGS.settings],
  );
  if (loyalty && !loyalty.ok) return loyalty;

  return writeSetting(
    'subscriptions',
    {
      discount_pct: input.subscriptionDiscountPct,
      default_discount_pct: input.subscriptionDiscountPct,
      notice_days: input.noticeDays,
    },
    [CACHE_TAGS.settings],
  );
}

// -----------------------------------------------------------------------------
// Referrals (docs/17 §2)
// -----------------------------------------------------------------------------

const referralSchema = z.object({
  enabled: z.string().optional(),
  ratePct: z.coerce.number().min(0).max(20),
  durationMonths: z.coerce.number().int().min(1).max(60),
  autoApprove: z.string().optional(),
  accrualMode: z.enum(['monthly', 'immediate']),
  minOrderEur: z.coerce.number().min(0).max(1000),
  maxPointsPerLinkPerYear: z.coerce.number().int().min(0).max(1_000_000),
});

/**
 * The programme's dials.
 *
 * Two of them deserve a word. `ratePct` changes what referrers are paid **from now on** — the terms
 * page promises that, and an accrual already written to `referral_earnings` is not rewritten by
 * anything here. And `accrualMode` is a privacy control rather than a performance one: `monthly`
 * batches the wallet movement so a referrer's ledger is not a dated list of when a referred customer
 * shopped (docs/17 §0.2). Switching it to `immediate` gives that away, which is why it is a
 * deliberate choice on a settings screen and not a default.
 */
export async function saveReferralSettings(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = referralSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;

  /*
   * The keys the SQL reads, spelled exactly as `accrue_referral_for_order` and `link_referral` read
   * them. `grace` is carried through unchanged because nothing exposes it yet — the grace window is
   * "until the first order" in code, and a settings field offering a choice the engine cannot honour
   * would be worse than no field.
   */
  return writeSetting(
    'referral',
    {
      enabled: input.enabled === 'on',
      rate_pct: input.ratePct,
      duration_months: input.durationMonths,
      auto_approve: input.autoApprove === 'on',
      accrual_mode: input.accrualMode,
      min_order_cents_to_count: toCents(input.minOrderEur),
      max_points_per_link_per_year: input.maxPointsPerLinkPerYear,
      max_referrals_per_customer: null,
      grace: 'until_first_order',
    },
    [CACHE_TAGS.settings],
  );
}

// -----------------------------------------------------------------------------
// Shipping methods
// -----------------------------------------------------------------------------

const shippingSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal('')),
    nameSq: z.string().trim().min(1, 'Required.').max(60),
    nameEn: z.string().trim().max(60).optional().or(z.literal('')),
    price: z.string().trim().min(1, 'Required — use 0 for free.'),
    freeOver: z.string().trim().optional().or(z.literal('')),
    minDays: z.coerce.number().int().min(0).max(60),
    maxDays: z.coerce.number().int().min(0).max(90),
    countries: z.string().trim().min(2, 'At least one country code, like XK.').max(120),
    position: z.coerce.number().int().min(0).max(100),
    isActive: z.string().optional(),
  })
  .refine((data) => data.maxDays >= data.minDays, {
    path: ['maxDays'],
    message: 'The longest estimate cannot be shorter than the shortest.',
  });

export async function saveShippingMethod(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = shippingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const input = parsed.data;
  const priceCents = toCents(input.price);
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    return fail<SettingsErrorKey, { message?: string }>('admin.settings.errors.checkFields', {
      price: ['An amount like 2.50, or 0.'],
    });
  }

  const freeOverCents = input.freeOver ? toCents(input.freeOver) : null;

  const patch = {
    name: { sq: input.nameSq, en: input.nameEn || input.nameSq } as unknown as Json,
    price_cents: priceCents,
    free_over_cents: freeOverCents && freeOverCents > 0 ? freeOverCents : null,
    min_days: input.minDays,
    max_days: input.maxDays,
    countries: input.countries
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
    position: input.position,
    is_active: input.isActive === 'on',
  };

  try {
    const supabase = await createClient();

    if (input.id) {
      const { data: before } = await supabase
        .from('shipping_methods')
        .select('*')
        .eq('id', input.id)
        .maybeSingle();

      if (!before) return settingsFail('admin.settings.errors.notFound');

      const { error } = await supabase.from('shipping_methods').update(patch).eq('id', input.id);
      if (error) {
        logger.error('saveShippingMethod update failed', { cause: error.message });
        return settingsFail('admin.errors.generic');
      }
      await audit('shipping.update', 'shipping_method', input.id, before, patch);
    } else {
      const { data, error } = await supabase
        .from('shipping_methods')
        .insert({ ...patch, description: {} as unknown as Json })
        .select('id')
        .single();

      if (error) {
        logger.error('saveShippingMethod insert failed', { cause: error.message });
        return settingsFail('admin.errors.generic');
      }
      await audit('shipping.create', 'shipping_method', (data as { id: string }).id, null, patch);
    }

    /*
     * Two tags, because two different readers care: checkout reads the methods, and the
     * free-shipping threshold appears on the cart and in the "€X more for free delivery" nudge.
     */
    revalidatePublic([CACHE_TAGS.shipping, CACHE_TAGS.settings]);
    revalidatePath('/admin/settings/shipping');
    return ok({ message: 'Saved.' });
  } catch (error) {
    logger.error('saveShippingMethod threw', describeError(error));
    return settingsFail('admin.errors.generic');
  }
}

// -----------------------------------------------------------------------------
// Team
// -----------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid address.'),
  fullName: z.string().trim().max(80).optional().or(z.literal('')),
  role: z.enum(STAFF_ROLES as unknown as [UserRole, ...UserRole[]]),
});

/**
 * docs/06 §15 — "invite by email (creates auth user via service + role)".
 *
 * This is service-role caller #8 in docs/02 §6, and it is unavoidable: creating an auth user is
 * a GoTrue admin operation with no user-context equivalent. The mitigation is that the *only*
 * thing the service client does here is mint the identity — the role is then written through the
 * **SSR client**, so `p_admin_update on profiles` and `prevent_role_escalation` both still apply.
 * A non-admin who found a way into this action could not grant a role.
 *
 * No password is set and no invite email is sent. A password would have to be transmitted
 * somehow, and every "somehow" is worse than the alternative: the new staff member uses "forgot
 * password" on the address they were invited with, which is the same flow they would use in six
 * months anyway. That path needs Resend (docs/14 §6) — until then the admin sets a password from
 * the Supabase dashboard.
 */
export async function inviteStaff(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<SettingsErrorKey, { message?: string }>(
      'admin.settings.errors.checkFields',
      parsed.error.flatten(),
    );
  }

  const { email, fullName, role } = parsed.data;

  try {
    const supabase = await createClient();

    // Already a user? Then this is a role grant, not an invitation.
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      const found = existing as { id: string; role: string };
      const { error } = await supabase
        .from('profiles')
        .update({ role, deleted_at: null })
        .eq('id', found.id);

      if (error) {
        logger.error('inviteStaff role grant failed', { cause: error.message });
        return settingsFail('admin.errors.generic');
      }

      await audit('team.grant', 'profile', found.id, { role: found.role }, { role });
      revalidatePath('/admin/settings/team');
      return ok({ message: `${email} already had an account — they now have the ${role} role.` });
    }

    const admin = createAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });

    if (authError || !created.user) {
      if (authError?.message.toLowerCase().includes('already')) {
        return settingsFail('admin.settings.errors.emailTaken');
      }
      logger.error('inviteStaff createUser failed', { cause: authError?.message });
      return settingsFail('admin.errors.generic');
    }

    /*
     * `handle_new_user` has already created the profile at role `customer`. The elevation runs
     * through the SSR client on purpose — see the note above. It is also why this cannot be one
     * statement: the trigger owns the insert, this owns the role.
     */
    const { error: roleError } = await supabase
      .from('profiles')
      .update({ role, full_name: fullName || null })
      .eq('id', created.user.id);

    if (roleError) {
      logger.error('inviteStaff role assignment failed', {
        cause: roleError.message,
        userId: created.user.id,
      });
      // The identity exists at role `customer`, which is harmless — say so rather than implying
      // a staff account was created.
      return settingsFail('admin.errors.generic');
    }

    await audit('team.invite', 'profile', created.user.id, null, { email, role });

    revalidatePath('/admin/settings/team');
    return ok({
      message: `${email} can now sign in with "forgot password" and will have the ${role} role.`,
    });
  } catch (error) {
    logger.error('inviteStaff threw', describeError(error));
    return settingsFail('admin.errors.generic');
  }
}

const roleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['customer', ...STAFF_ROLES] as unknown as [UserRole, ...UserRole[]]),
});

/** Change a staff member's role, or drop them back to `customer` to remove their access. */
export async function changeStaffRole(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = roleChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return settingsFail('admin.settings.errors.checkFields');

  const { userId, role } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('profiles')
      .select('email, role')
      .eq('id', userId)
      .maybeSingle();

    if (!before) return settingsFail('admin.settings.errors.notFound');
    const current = before as { email: string; role: string };

    /*
     * Refuse to remove the last admin. Nobody would then be able to restore anyone's access —
     * including their own — and the recovery is a SQL console, which is exactly the situation
     * an admin panel exists to avoid.
     */
    if (current.role === 'admin' && role !== 'admin') {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .is('deleted_at', null);

      if ((count ?? 0) <= 1) return settingsFail('admin.settings.errors.lastAdmin');
    }

    const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);

    if (error) {
      logger.error('changeStaffRole failed', { cause: error.message, userId });
      return settingsFail('admin.errors.generic');
    }

    await audit('team.role', 'profile', userId, current, { role });

    revalidatePath('/admin/settings/team');
    return ok({ message: `${current.email} is now ${role}.` });
  } catch (error) {
    logger.error('changeStaffRole threw', describeError(error));
    return settingsFail('admin.errors.generic');
  }
}

const deactivateSchema = z.object({
  userId: z.string().uuid(),
  active: z.enum(['true', 'false']),
});

/**
 * Deactivate or restore a staff member.
 *
 * Soft: `deleted_at` is stamped and the role is left alone, so restoring someone gives back the
 * access they had rather than making an admin remember what it was.
 *
 * Two layers, because one is not enough:
 *
 *  1. `deleted_at` makes `getProfile` return null, which revokes the session they are holding
 *     right now — every guard in the app already asks that function.
 *  2. A **GoTrue ban** stops them getting a new one. Without it, `deleted_at` alone would leave
 *     someone able to sign in successfully and then bounce off every page, which reads as a
 *     broken app rather than a revoked account — and their access token stays valid until it
 *     expires regardless.
 *
 * The ban is why this is service-role caller #8's second operation (docs/02 §6): there is no
 * user-context way to ban a user, and the alternative — deleting them — fails on eleven foreign
 * keys (docs/13 §M9).
 */
export async function setStaffActive(
  _previous: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const gate = await requireCapability('settings.manage');
  if (!gate.ok) return settingsFail(gate.error);

  const parsed = deactivateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return settingsFail('admin.settings.errors.checkFields');

  const { userId, active } = parsed.data;
  const activate = active === 'true';

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('profiles')
      .select('email, role, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (!before) return settingsFail('admin.settings.errors.notFound');
    const current = before as { email: string; role: string; deleted_at: string | null };

    if (!activate && current.role === 'admin') {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .is('deleted_at', null);

      if ((count ?? 0) <= 1) return settingsFail('admin.settings.errors.lastAdmin');
    }

    const { error } = await supabase
      .from('profiles')
      .update({ deleted_at: activate ? null : new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      logger.error('setStaffActive failed', { cause: error.message, userId });
      return settingsFail('admin.errors.generic');
    }

    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      // Supabase expects a duration string; 'none' lifts it.
      ban_duration: activate ? 'none' : '876000h',
    });

    /*
     * Reported, not swallowed. The profile flag has already taken their access away, so the
     * account is not usable — but a failed ban means they can still obtain a session, and an
     * admin who was told "deactivated" would have no reason to check.
     */
    if (banError) {
      logger.error('Staff ban not applied', { userId, cause: banError.message });
      await audit('team.deactivate_partial', 'profile', userId, current, {
        reason: 'auth ban not applied',
      });
      return settingsFail('admin.errors.generic');
    }

    await audit(activate ? 'team.restore' : 'team.deactivate', 'profile', userId, current, {
      deactivated: !activate,
    });

    revalidatePath('/admin/settings/team');
    return ok({
      message: `${current.email} ${activate ? 'can sign in again' : 'is deactivated'}.`,
    });
  } catch (error) {
    logger.error('setStaffActive threw', describeError(error));
    return settingsFail('admin.errors.generic');
  }
}
