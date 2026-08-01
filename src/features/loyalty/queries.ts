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

export const LOYALTY_REASONS = [
  'earn_order',
  'redeem',
  'adjustment',
  'expiry',
  'clawback',
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
  /** Points needed for one redemption, and what it is worth. From `settings.loyalty`. */
  redeemPoints: number;
  redeemValueCents: number;
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
  redeemPoints: number;
  redeemValueCents: number;
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

  return {
    redeemPoints: num('redeem_points', 100),
    redeemValueCents: num('redeem_value_cents', 500),
    earnRate: num('earn_rate_points_per_eur', 1),
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
    redeemPoints: settings.redeemPoints,
    redeemValueCents: settings.redeemValueCents,
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
