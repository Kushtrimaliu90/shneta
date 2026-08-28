'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { requireCapability } from '@/features/admin/audit';
import { referralCodeSchema } from '@/features/referrals/schemas';

/**
 * docs/17 §5 — the referral mutations.
 *
 * Every one of these is a thin wrapper: parse, check the capability, call the RPC, translate the
 * error. The rules and the audit row both live in SQL (migration 59), which is what makes them true
 * for the cron and for a psql session as well as for this file — an action is one caller, and putting
 * the only role check here would mean the guarantee held exactly as long as nobody wrote a second one.
 *
 * The IP is read here and passed down, because only the request knows it. Without it the referral audit
 * rows would be the one set in the panel with a null `ip` column.
 */

export type ReferralAdminErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'referrals.errors.checkFields'
  | 'referrals.errors.notFound'
  | 'referrals.errors.alreadyDecided'
  | 'referrals.errors.notActive'
  | 'referrals.errors.alreadyExtended'
  | 'referrals.errors.reasonRequired'
  | 'referrals.errors.noteRequired'
  | 'referrals.errors.refereeNotFound'
  | 'referrals.errors.linkRefused';

export type ReferralAdminState = ActionResult<{ message?: string }, ReferralAdminErrorKey> | null;

function adminFail(error: ReferralAdminErrorKey): ReferralAdminState {
  return fail<ReferralAdminErrorKey, { message?: string }>(error);
}

/**
 * Maps the RPC's exception text onto a key.
 *
 * The RPCs raise named conditions (`LINK_NOT_FOUND`, `ALREADY_EXTENDED`, `LINK_REFUSED:cycle`) rather
 * than prose, precisely so this can be a lookup instead of string archaeology. Anything unrecognised
 * becomes the generic key and is logged in full — a new condition should show up in the logs, not as a
 * blank panel.
 */
function keyForRpcError(message: string): ReferralAdminErrorKey {
  if (message.includes('FORBIDDEN')) return 'admin.errors.forbidden';
  if (message.includes('LINK_NOT_FOUND')) return 'referrals.errors.notFound';
  if (message.includes('LINK_ALREADY_DECIDED')) return 'referrals.errors.alreadyDecided';
  if (message.includes('LINK_NOT_ACTIVE')) return 'referrals.errors.notActive';
  if (message.includes('ALREADY_EXTENDED')) return 'referrals.errors.alreadyExtended';
  if (message.includes('REASON_REQUIRED')) return 'referrals.errors.reasonRequired';
  if (message.includes('NOTE_REQUIRED')) return 'referrals.errors.noteRequired';
  if (message.includes('REFEREE_NOT_FOUND')) return 'referrals.errors.refereeNotFound';
  if (message.includes('LINK_REFUSED')) return 'referrals.errors.linkRefused';
  return 'admin.errors.generic';
}

async function clientIp(): Promise<string | undefined> {
  const bag = await headers();
  return bag.get('x-forwarded-for')?.split(',')[0]?.trim() ?? bag.get('x-real-ip') ?? undefined;
}

/** Every mutation lands on the same screen, so they all revalidate the same one place. */
function revalidate(): void {
  revalidatePath('/admin/referrals');
}

// ---------------------------------------------------------------------------
// Queue: approve / reject
// ---------------------------------------------------------------------------

const decideSchema = z.object({
  linkId: z.string().uuid(),
  approve: z.enum(['true', 'false']),
  note: z.string().trim().max(300).optional().or(z.literal('')),
});

export async function decideReferral(
  _prev: ReferralAdminState,
  formData: FormData,
): Promise<ReferralAdminState> {
  const parsed = decideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return adminFail('referrals.errors.checkFields');

  const guard = await requireCapability('referrals.review');
  if (!guard.ok) return adminFail(guard.error);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_decide_referral', {
      p_link_id: parsed.data.linkId,
      p_approve: parsed.data.approve === 'true',
      p_note: parsed.data.note || undefined,
      p_ip: await clientIp(),
    });
    if (error) return adminFail(keyForRpcError(error.message));
  } catch (error) {
    logger.error('decideReferral failed', describeError(error));
    return adminFail('admin.errors.generic');
  }

  revalidate();
  return ok<{ message?: string }>({});
}

// ---------------------------------------------------------------------------
// Revoke — one link, or every link a referrer holds
// ---------------------------------------------------------------------------

const revokeSchema = z.object({
  linkId: z.string().uuid(),
  reason: z.string().trim().min(3, 'A reason is required.').max(300),
});

export async function revokeReferral(
  _prev: ReferralAdminState,
  formData: FormData,
): Promise<ReferralAdminState> {
  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return adminFail('referrals.errors.reasonRequired');

  const guard = await requireCapability('referrals.review');
  if (!guard.ok) return adminFail(guard.error);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_revoke_referral', {
      p_link_id: parsed.data.linkId,
      p_reason: parsed.data.reason,
      p_ip: await clientIp(),
    });
    if (error) return adminFail(keyForRpcError(error.message));
  } catch (error) {
    logger.error('revokeReferral failed', describeError(error));
    return adminFail('admin.errors.generic');
  }

  revalidate();
  return ok<{ message?: string }>({});
}

const revokeAllSchema = z.object({
  referrerId: z.string().uuid(),
  reason: z.string().trim().min(3, 'A reason is required.').max(300),
});

/** The fraud panel's blunt instrument. Admin only — this turns off somebody's income. */
export async function revokeAllReferrals(
  _prev: ReferralAdminState,
  formData: FormData,
): Promise<ReferralAdminState> {
  const parsed = revokeAllSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return adminFail('referrals.errors.reasonRequired');

  const guard = await requireCapability('referrals.manage');
  if (!guard.ok) return adminFail(guard.error);

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_revoke_referrals_for', {
      p_referrer_id: parsed.data.referrerId,
      p_reason: parsed.data.reason,
      p_ip: await clientIp(),
    });
    if (error) return adminFail(keyForRpcError(error.message));

    revalidate();
    return ok<{ message?: string }>({ message: `Stopped ${data ?? 0} link(s).` });
  } catch (error) {
    logger.error('revokeAllReferrals failed', describeError(error));
    return adminFail('admin.errors.generic');
  }
}

// ---------------------------------------------------------------------------
// Extend — once, with a note
// ---------------------------------------------------------------------------

const extendSchema = z.object({
  linkId: z.string().uuid(),
  months: z.coerce.number().int().min(1).max(12),
  note: z.string().trim().min(3, 'A note is required.').max(300),
});

export async function extendReferral(
  _prev: ReferralAdminState,
  formData: FormData,
): Promise<ReferralAdminState> {
  const parsed = extendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return adminFail('referrals.errors.checkFields');

  const guard = await requireCapability('referrals.manage');
  if (!guard.ok) return adminFail(guard.error);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_extend_referral', {
      p_link_id: parsed.data.linkId,
      p_months: parsed.data.months,
      p_note: parsed.data.note,
      p_ip: await clientIp(),
    });
    if (error) return adminFail(keyForRpcError(error.message));
  } catch (error) {
    logger.error('extendReferral failed', describeError(error));
    return adminFail('admin.errors.generic');
  }

  revalidate();
  return ok<{ message?: string }>({});
}

// ---------------------------------------------------------------------------
// Manual link
// ---------------------------------------------------------------------------

const manualSchema = z.object({
  code: referralCodeSchema,
  email: z.string().trim().toLowerCase().email('Not an email address.'),
  note: z.string().trim().min(3, 'A note is required.').max(300),
  backdateDays: z.coerce.number().int().min(0).max(365).default(0),
});

/**
 * For the case the software cannot see: a customer bought on a friend's recommendation and never typed
 * the code. Identified by the referrer's code and the referee's email — what an operator has in front
 * of them, not two uuids.
 */
export async function createManualReferral(
  _prev: ReferralAdminState,
  formData: FormData,
): Promise<ReferralAdminState> {
  const parsed = manualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return adminFail('referrals.errors.checkFields');

  const guard = await requireCapability('referrals.manage');
  if (!guard.ok) return adminFail(guard.error);

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_create_referral_link', {
      p_code: parsed.data.code,
      p_referee_email: parsed.data.email,
      p_note: parsed.data.note,
      p_backdate_days: parsed.data.backdateDays,
      p_ip: await clientIp(),
    });
    if (error) return adminFail(keyForRpcError(error.message));
  } catch (error) {
    logger.error('createManualReferral failed', describeError(error));
    return adminFail('admin.errors.generic');
  }

  revalidate();
  return ok<{ message?: string }>({ message: 'Linked and approved.' });
}
