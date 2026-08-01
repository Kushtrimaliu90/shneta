'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';

/**
 * docs/07 §9 — redeem points for a coupon.
 *
 * Almost nothing happens here, and that is the design. `redeem_loyalty_points()` locks the
 * profile row, checks the balance, mints the coupon and writes the ledger entry **in one
 * transaction** — so two clicks a millisecond apart cannot both pass a balance check that only
 * one of them can afford. Doing any of that in TypeScript would reintroduce exactly that race
 * (docs/13 §B4, which is why the RPC exists at all).
 *
 * The code is shown once, in the response. It is also a real row in `coupons`, so a customer who
 * loses the tab finds it again at checkout — but nothing in the UI lists their codes back to
 * them, which is a gap worth naming rather than pretending away (docs/14 §12).
 */

export type LoyaltyErrorKey =
  | 'account.loyalty.errors.signedOut'
  | 'account.loyalty.errors.insufficient'
  | 'account.loyalty.errors.generic';

export type RedeemState = ActionResult<
  { code: string; valueCents: number; pointsSpent: number } | null,
  LoyaltyErrorKey
> | null;

type RedeemData = { code: string; valueCents: number; pointsSpent: number } | null;

export async function redeemLoyalty(_previous: RedeemState): Promise<RedeemState> {
  const user = await getCurrentUser();
  if (!user) return fail<LoyaltyErrorKey, RedeemData>('account.loyalty.errors.signedOut');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('redeem_loyalty_points');

    if (error) {
      // The RPC raises `INSUFFICIENT_POINTS` by name so the customer can be told the real
      // reason rather than "something went wrong" — the one failure they can act on.
      if (error.message.includes('INSUFFICIENT_POINTS')) {
        return fail<LoyaltyErrorKey, RedeemData>('account.loyalty.errors.insufficient');
      }
      logger.error('redeemLoyalty failed', { cause: error.message });
      return fail<LoyaltyErrorKey, RedeemData>('account.loyalty.errors.generic');
    }

    const result = data as { code?: string; value_cents?: number; points_spent?: number } | null;
    if (!result?.code) {
      logger.error('redeemLoyalty returned no code', { data: JSON.stringify(data) });
      return fail<LoyaltyErrorKey, RedeemData>('account.loyalty.errors.generic');
    }

    revalidatePath('/account/loyalty');
    revalidatePath('/account');

    return ok({
      code: result.code,
      valueCents: result.value_cents ?? 0,
      pointsSpent: result.points_spent ?? 0,
    });
  } catch (error) {
    logger.error('redeemLoyalty threw', describeError(error));
    return fail<LoyaltyErrorKey, RedeemData>('account.loyalty.errors.generic');
  }
}
