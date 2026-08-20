import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeReferralCode } from '@/features/referrals/schemas';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * Claims the `/r/{CODE}` cookie for whoever has just been signed in.
 *
 * Shared by `/api/auth/callback` (OAuth) and `/api/auth/confirm` (email links), because both are
 * places where a session appears for the first time and a referral may still be unclaimed.
 *
 * The email sign-up path does not need it — the code rides in `raw_user_meta_data` and
 * `handle_new_user` links it inside the same transaction that creates the profile. **`signInWithOAuth`
 * cannot carry user metadata**, so without this a visitor who followed a share link and then chose
 * "Continue with Google" was credited to nobody, silently, and unfixably once the grace window closed.
 *
 * Goes through `claim_referral_code` — the same RPC the account page uses — and deliberately not
 * `link_referral`, which is revoked from `authenticated` and only reachable from the trigger's
 * security-definer context. This runs as the customer, under RLS.
 *
 * **Never throws and never blocks a sign-in.** A dropped claim is a support ticket an admin can fix
 * from `/admin/referrals`; a sign-in that dead-ends because a referral lookup failed is a lost
 * customer.
 */
export async function claimReferralFromCookie(supabase: SupabaseClient): Promise<void> {
  try {
    const store = await cookies();
    const raw = store.get(REFERRAL_COOKIE_NAME)?.value;
    if (!raw) return;

    const code = normalizeReferralCode(raw);
    if (!code) {
      // A malformed cookie is not worth keeping around to fail again next time.
      store.delete(REFERRAL_COOKIE_NAME);
      return;
    }

    const { data, error } = await supabase.rpc('claim_referral_code', { p_code: code });
    const status = (data as { status?: string } | null)?.status ?? null;

    if (error) {
      logger.warn('Referral claim after auth callback failed', { cause: error.message });
      return;
    }

    /*
     * The cookie is spent on any definitive answer, including `invalid` — a code the database has
     * rejected will be rejected again, and leaving it set means re-asking on every future callback.
     * `already_linked` is the ordinary email-link case and is not worth a log line.
     */
    if (status && status !== 'already_linked') {
      logger.info('Referral claim after auth callback', { status });
    }
    store.delete(REFERRAL_COOKIE_NAME);
  } catch (cause) {
    logger.warn('Referral claim after auth callback threw', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
