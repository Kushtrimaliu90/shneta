'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { limit, limitByIp } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';
import { claimReferralCodeSchema } from '@/features/referrals/schemas';

/**
 * docs/17 §1, §6 — naming a referrer during the grace window.
 *
 * All validation is in `claim_referral_code()`. This action authenticates, rate-limits, and maps the
 * one outcome word the RPC returns to a message key. It does not decide anything: putting "is this
 * code valid" in TypeScript would mean the sign-up path and this path could disagree, and the sign-up
 * path runs inside a database trigger where TypeScript cannot follow.
 */

export type ReferralErrorKey =
  | 'account.referrals.errors.invalid'
  | 'account.referrals.errors.alreadyLinked'
  | 'account.referrals.errors.self'
  | 'account.referrals.errors.graceClosed'
  | 'account.referrals.errors.tooManyAttempts'
  | 'account.referrals.errors.notSignedIn'
  | 'account.referrals.errors.generic';

export type ReferralSuccessKey = 'account.referrals.claimed';

type ClaimData = { message: ReferralSuccessKey };

export type ClaimFormState = ActionResult<ClaimData, ReferralErrorKey> | null;

/** The statuses `claim_referral_code` may answer with, mapped to what the customer reads. */
const OUTCOMES: Record<string, ReferralErrorKey> = {
  invalid: 'account.referrals.errors.invalid',
  already_linked: 'account.referrals.errors.alreadyLinked',
  self: 'account.referrals.errors.self',
  grace_closed: 'account.referrals.errors.graceClosed',
};

export async function claimReferralCode(
  _prevState: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const parsed = claimReferralCodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fromFieldErrors<ReferralErrorKey, ClaimData>(
      'account.referrals.errors.invalid',
      parsed.error.flatten(),
    );
  }

  const user = await getCurrentUser();
  if (!user) return fail<ReferralErrorKey, ClaimData>('account.referrals.errors.notSignedIn');

  /*
   * Both buckets, because they stop different things (§6). Per-IP stops one machine walking the code
   * space across many accounts; per-account stops one account walking it from many addresses. Ten an
   * hour each: a customer submits once, or twice after a typo.
   */
  const ipAllowed = await limitByIp('referralClaim', await headers());
  const accountAllowed = await limit('referralClaim', user.id);
  if (!ipAllowed || !accountAllowed) {
    return fail<ReferralErrorKey, ClaimData>('account.referrals.errors.tooManyAttempts');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('claim_referral_code', { p_code: parsed.data.code });

  if (error) {
    logger.error('claim_referral_code failed', { cause: error.message });
    return fail<ReferralErrorKey, ClaimData>('account.referrals.errors.generic');
  }

  const status = (data as { status?: string } | null)?.status ?? 'invalid';

  if (status !== 'ok') {
    const key = OUTCOMES[status];
    if (!key) {
      // A status this build does not know about. Log it and say the neutral thing.
      logger.warn('claim_referral_code returned an unknown status', { status });
      return fail<ReferralErrorKey, ClaimData>('account.referrals.errors.invalid');
    }
    return fail<ReferralErrorKey, ClaimData>(key);
  }

  /*
   * The cookie has done its job. Clearing it stops a stale invite from re-appearing in a form months
   * later on a shared computer, where the next person to register would inherit it.
   */
  const store = await cookies();
  store.delete(REFERRAL_COOKIE_NAME);

  revalidatePath('/account');
  return ok<ClaimData>({ message: 'account.referrals.claimed' });
}
