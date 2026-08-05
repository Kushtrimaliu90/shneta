import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { getCurrentUser } from '@/features/auth/queries';

/**
 * docs/05 §14 and docs/07 §9 — the loyalty ledger.
 *
 * Nothing here computes a balance. `profiles.loyalty_points` is maintained by
 * `sync_loyalty_balance`, which fires on every `loyalty_transactions` insert, and
 * `guard_profile_self_update` refuses any other writer. So the ledger and the balance cannot
 * drift, and a second implementation in TypeScript could only ever disagree with the first.
 *
 * Reads go through the SSR client: `p_own on loyalty_transactions` scopes the ledger to
 * `auth.uid()`, so there is no user filter here to forget.
 */

/**
 * Every reason the ledger's check constraint allows (migration 58).
 *
 * The list has to match, or `toReason` quietly relabels an unknown reason as `adjustment` — so a
 * referral reward would appear on the customer's own points page as "Adjustment", which reads like
 * somebody at BioCode moved their balance by hand.
 */
export const LOYALTY_REASONS = [
  'earn_order',
  'redeem',
  'adjustment',
  'expiry',
  'clawback',
  'referral',
  'referral_clawback',
] as const;
export type LoyaltyReason = (typeof LOYALTY_REASONS)[number];

export interface LedgerEntry {
  id: string;
  points: number;
  reason: LoyaltyReason;
  note: string | null;
  createdAt: string;
  /** The order that earned or lost the points, when there was one. */
  orderNumber: string | null;
}

export interface LoyaltyView {
  balance: number;
  /** The smallest redemption allowed and what one point is worth, from `settings.loyalty` (docs/17 §0.1). */
  minRedeemPoints: number;
  pointValueCents: number;
  entries: LedgerEntry[];
}

function toReason(value: string): LoyaltyReason {
  return (LOYALTY_REASONS as readonly string[]).includes(value)
    ? (value as LoyaltyReason)
    : 'adjustment';
}

/**
 * The redemption terms.
 *
 * From `settings`, not hardcoded, because `redeem_loyalty_points()` reads the same row — a
 * constant here would eventually promise "100 points for €5" on a page whose button spends a
 * different number.
 */
export async function getLoyaltySettings(): Promise<{
  minRedeemPoints: number;
  pointValueCents: number;
  earnRate: number;
}> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'loyalty')
    .maybeSingle();

  const value = ((data as { value: Record<string, unknown> } | null)?.value ?? {}) as Record<
    string,
    unknown
  >;
  const num = (key: string, fallback: number) =>
    typeof value[key] === 'number' ? (value[key] as number) : fallback;

  /*
   * docs/17 §0.1 — one point value, 1 point = €0.01.
   *
   * `minRedeemPoints` replaces the old fixed `redeem_points` tier, and `pointValueCents` replaces the
   * `redeem_value_cents` that used to be the value of that one tier. Both fall back to the old key so a
   * settings row that has not been migrated still reads sensibly rather than returning zero — and
   * `redeem_value_cents / redeem_points` is exactly the old point value, so the fallback is a
   * conversion rather than a guess.
   */
  const legacyTier = num('redeem_points', 0);
  const legacyValue = num('redeem_value_cents', 0);
  const legacyPointValue = legacyTier > 0 ? Math.round(legacyValue / legacyTier) : 0;

  return {
    minRedeemPoints: num('min_redeem_points', legacyTier || 500),
    pointValueCents: num('point_value_cents', legacyPointValue || 1),
    earnRate: num('earn_points_per_eur', num('earn_rate_points_per_eur', 1)),
  };
}

export async function getLoyalty(): Promise<LoyaltyView | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();

  const [{ data: profile }, { data: ledger, error }, settings] = await Promise.all([
    supabase.from('profiles').select('loyalty_points').eq('id', user.id).maybeSingle(),
    supabase
      .from('loyalty_transactions')
      .select('id, points, reason, note, created_at, orders ( order_number )')
      .order('created_at', { ascending: false })
      .limit(100),
    getLoyaltySettings(),
  ]);

  if (error) {
    logger.error('getLoyalty ledger failed', { cause: error.message });
  }

  const rows = (ledger ?? []) as unknown as {
    id: string;
    points: number;
    reason: string;
    note: string | null;
    created_at: string;
    orders: { order_number: string } | null;
  }[];

  return {
    balance: (profile as { loyalty_points: number } | null)?.loyalty_points ?? 0,
    minRedeemPoints: settings.minRedeemPoints,
    pointValueCents: settings.pointValueCents,
    entries: rows.map((row) => ({
      id: row.id,
      points: row.points,
      reason: toReason(row.reason),
      note: row.note,
      createdAt: row.created_at,
      orderNumber: row.orders?.order_number ?? null,
    })),
  };
}
