import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import { normalizeReferralCode } from '@/features/referrals/schemas';

/**
 * docs/17 §4, §6 — reads for the referral programme.
 *
 * Nothing here reads `referral_links` for a referrer: that policy does not exist, on purpose. The
 * referrer's view arrives through `my_referral_overview()` (step 5). What is here is the referee's
 * side — who invited me, and may I still say who it was.
 */

/** Whether the programme is on at all, from settings rather than a build-time flag. */
export async function isReferralProgrammeEnabled(): Promise<boolean> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'referral')
    .maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value;
  return value?.enabled === true;
}

/** The code from `/r/{CODE}`, if the visitor followed one, normalised for display in the field. */
export async function getInviteCodeFromCookie(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(REFERRAL_COOKIE_NAME)?.value;
  return raw ? normalizeReferralCode(raw) : null;
}

export interface ReferralSource {
  /** The referrer's first name and an initial — never the full name, never contact details. */
  referrerName: string;
  codeUsed: string | null;
  status: string;
  joinedMonth: string | null;
}

export interface CodeEntryState {
  /** True while the customer may still name a referrer: no link yet, and no order yet. */
  canEnter: boolean;
  /** Set once a link exists, so the account page can show the quiet line instead of the form. */
  source: ReferralSource | null;
  /** Pre-filled from the `/r/{CODE}` cookie. */
  suggestedCode: string | null;
}

/**
 * Everything the account page needs to decide between "enter a code", "you were invited by …", and
 * showing nothing at all.
 *
 * The grace window is computed from `orders`, not from a flag on the profile, and the check is a
 * `head` count through RLS — `p_own on orders` scopes it to the caller, so there is no user filter
 * here to get wrong. docs/17 §1: entry closes at the first order, because a referral rewards
 * bringing a *new* customer and somebody who has already shopped here arrived on their own.
 */
export async function getCodeEntryState(): Promise<CodeEntryState> {
  const user = await getCurrentUser();
  if (!user) return { canEnter: false, source: null, suggestedCode: null };

  const supabase = await createClient();

  const [{ data: sourceRow, error: sourceError }, { count, error: orderError }, enabled, cookieCode] =
    await Promise.all([
      supabase.rpc('my_referral_source'),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      isReferralProgrammeEnabled(),
      getInviteCodeFromCookie(),
    ]);

  if (sourceError) logger.error('my_referral_source failed', { cause: sourceError.message });
  if (orderError) logger.error('referral grace order count failed', { cause: orderError.message });

  const raw = sourceRow as {
    referrer_name?: string;
    code_used?: string | null;
    status?: string;
    joined_month?: string | null;
  } | null;

  const source: ReferralSource | null = raw
    ? {
        referrerName: raw.referrer_name ?? '',
        codeUsed: raw.code_used ?? null,
        status: raw.status ?? 'pending',
        joinedMonth: raw.joined_month ?? null,
      }
    : null;

  /*
   * A failed order count closes the window rather than opening it.
   *
   * `count` is null both when the query failed and when it legitimately returned nothing, and those
   * two cases want opposite answers. Treating unknown as "has ordered" means a transient error hides
   * an optional form for a few seconds; treating it as "has not" would let somebody past the grace
   * window because a read timed out.
   */
  const hasOrdered = orderError ? true : (count ?? 0) > 0;

  return {
    canEnter: enabled && !source && !hasOrdered,
    source,
    suggestedCode: cookieCode,
  };
}
