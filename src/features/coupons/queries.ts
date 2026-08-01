import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import type { Database } from '@/lib/supabase/database.types';

export type DiscountType = Database['public']['Enums']['discount_type'];

export interface CouponRow {
  id: string;
  code: string;
  type: DiscountType;
  /** Percent for `percentage`, cents for `fixed`, unused for `free_shipping`. */
  value: number;
  minSubtotalCents: number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  isSystem: boolean;
  note: string | null;
  redemptionCount: number;
  lastRedeemedAt: string | null;
}

interface RawCoupon {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  min_subtotal_cents: number | null;
  max_uses: number | null;
  max_uses_per_user: number | null;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  is_system: boolean;
  note: string | null;
  redemption_count: number;
  last_redeemed_at: string | null;
}

/**
 * docs/06 §11 — every coupon with its usage.
 *
 * System coupons are included rather than hidden. `SUB-10` is what discounts every subscription
 * renewal and the `LOY-*` codes are minted by the points exchange; an operator debugging "why is
 * this order €0.99 cheaper" needs to be able to find them. They are marked, and the editor
 * refuses to touch them.
 */
export async function listCoupons(): Promise<CouponRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_admin_coupons')
    .select(
      `id, code, type, value, min_subtotal_cents, max_uses, max_uses_per_user, starts_at,
       ends_at, is_active, is_system, note, redemption_count, last_redeemed_at`,
    )
    .order('is_system', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('listCoupons failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as RawCoupon[]).map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    minSubtotalCents: row.min_subtotal_cents,
    maxUses: row.max_uses,
    maxUsesPerUser: row.max_uses_per_user,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
    isSystem: row.is_system,
    note: row.note,
    redemptionCount: row.redemption_count,
    lastRedeemedAt: row.last_redeemed_at,
  }));
}
