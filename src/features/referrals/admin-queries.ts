import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/17 §5 — reads for `/admin/referrals`.
 *
 * Everything here goes through the SSR client, so `p_staff_read on referral_links` and
 * `p_staff_read on referral_earnings` are what admit it. The service-role client is deliberately not
 * used: an admin panel is a user-context surface, and reaching for the bypass here would mean the
 * staff-only policies were never actually exercised (CLAUDE.md §5).
 *
 * Unlike the customer side, this *does* show amounts against named people. That is the point of the
 * screen — somebody has to be able to answer "why was this paid?" — and it is why the capability is
 * staff-only rather than something a customer session can reach.
 */

export interface AdminReferralRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  source: string;
  codeUsed: string | null;
  riskFlags: string[];
  createdAt: string;
  linkedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  extendedCount: number;
  referrer: { id: string; name: string | null; email: string; code: string | null };
  referee: { id: string; name: string | null; email: string };
  /** Signed sum of this link's earnings, so a refunded order shows as a reduction. */
  pointsEarned: number;
  /**
   * Days between the referrer's account being created and the referee's.
   *
   * docs/17 §5 calls it the "signup gap" and it is the single most useful number in the queue: two
   * accounts created four minutes apart, by the same person, look exactly like this.
   */
  signupGapDays: number | null;
}

interface LinkQueryRow {
  id: string;
  status: string;
  source: string;
  code_used: string | null;
  risk_flags: string[] | null;
  created_at: string;
  linked_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  extended_count: number | null;
  referrer: {
    id: string;
    full_name: string | null;
    email: string;
    referral_code: string | null;
    created_at: string;
  } | null;
  referee: { id: string; full_name: string | null; email: string; created_at: string } | null;
}

const STATUSES = ['pending', 'approved', 'rejected', 'revoked', 'expired'] as const;

function toStatus(value: string): AdminReferralRow['status'] {
  return (STATUSES as readonly string[]).includes(value)
    ? (value as AdminReferralRow['status'])
    : 'pending';
}

function dayGap(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null;
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

/*
 * The two `profiles` joins are disambiguated by constraint name, because `referral_links` has two FKs
 * to the same table and PostgREST cannot guess which one `profiles(...)` means. Getting this wrong
 * returns rows with the referrer's details in the referee's column, which reads as plausible data.
 */
const LINK_SELECT = `
  id, status, source, code_used, risk_flags, created_at, linked_at, expires_at,
  revoked_at, revoke_reason, extended_count,
  referrer:profiles!referral_links_referrer_id_fkey ( id, full_name, email, referral_code, created_at ),
  referee:profiles!referral_links_referee_id_fkey ( id, full_name, email, created_at )
`;

async function withEarnings(rows: LinkQueryRow[]): Promise<AdminReferralRow[]> {
  if (rows.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('referral_earnings')
    .select('link_id, points')
    .in(
      'link_id',
      rows.map((row) => row.id),
    );

  if (error) logger.error('referral earnings roll-up failed', { cause: error.message });

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as { link_id: string; points: number }[]) {
    totals.set(row.link_id, (totals.get(row.link_id) ?? 0) + row.points);
  }

  return rows.map((row) => ({
    id: row.id,
    status: toStatus(row.status),
    source: row.source,
    codeUsed: row.code_used,
    riskFlags: row.risk_flags ?? [],
    createdAt: row.created_at,
    linkedAt: row.linked_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    extendedCount: row.extended_count ?? 0,
    referrer: {
      id: row.referrer?.id ?? '',
      name: row.referrer?.full_name ?? null,
      email: row.referrer?.email ?? '',
      code: row.referrer?.referral_code ?? null,
    },
    referee: {
      id: row.referee?.id ?? '',
      name: row.referee?.full_name ?? null,
      email: row.referee?.email ?? '',
    },
    pointsEarned: totals.get(row.id) ?? 0,
    signupGapDays: dayGap(row.referrer?.created_at, row.referee?.created_at),
  }));
}

/** The queue: everything waiting for a decision, oldest first — a queue, not a feed. */
export async function listReferralQueue(): Promise<AdminReferralRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('referral_links')
    .select(LINK_SELECT)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    logger.error('listReferralQueue failed', { cause: error.message });
    return [];
  }
  return withEarnings((data ?? []) as unknown as LinkQueryRow[]);
}

export interface LinkFilter {
  status?: string;
  /** Matches either party's email, or the code that was used. */
  search?: string;
}

export async function listReferralLinks(filter?: LinkFilter): Promise<AdminReferralRow[]> {
  const supabase = await createClient();
  let query = supabase.from('referral_links').select(LINK_SELECT);

  /*
   * Narrowed through `toStatus` rather than cast. The filter arrives as a search-param string, and the
   * generated types make `eq('status', …)` accept only the enum — so an unrecognised value becomes
   * `pending` here, which is a harmless filter, instead of being asserted past the compiler and sent to
   * Postgres as an invalid enum literal.
   */
  if (filter?.status && (STATUSES as readonly string[]).includes(filter.status)) {
    query = query.eq('status', toStatus(filter.status));
  }

  /*
   * Search hits the code on the link rather than joining to `profiles` for an email match, because
   * PostgREST cannot filter on an embedded resource without turning the join into an inner one — which
   * would silently drop any link whose referee profile was anonymised (docs/06 §9 GDPR). The code is
   * what an operator has in front of them anyway.
   */
  const search = filter?.search?.trim();
  if (search) query = query.ilike('code_used', `%${search}%`);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);

  if (error) {
    logger.error('listReferralLinks failed', { cause: error.message });
    return [];
  }
  return withEarnings((data ?? []) as unknown as LinkQueryRow[]);
}

export interface AdminEarningRow {
  id: string;
  createdAt: string;
  reason: string;
  baseCents: number;
  points: number;
  posted: boolean;
  orderNumber: string | null;
  referrerEmail: string;
  refereeEmail: string;
}

export async function listReferralEarnings(limit = 500): Promise<AdminEarningRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('referral_earnings')
    .select(
      `id, created_at, reason, base_cents, points, loyalty_transaction_id,
       orders ( order_number ),
       referral_links (
         referrer:profiles!referral_links_referrer_id_fkey ( email ),
         referee:profiles!referral_links_referee_id_fkey ( email )
       )`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('listReferralEarnings failed', { cause: error.message });
    return [];
  }

  return (
    (data ?? []) as unknown as {
      id: string;
      created_at: string;
      reason: string;
      base_cents: number;
      points: number;
      loyalty_transaction_id: string | null;
      orders: { order_number: string } | null;
      referral_links: {
        referrer: { email: string } | null;
        referee: { email: string } | null;
      } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    reason: row.reason,
    baseCents: row.base_cents,
    points: row.points,
    posted: row.loyalty_transaction_id !== null,
    orderNumber: row.orders?.order_number ?? null,
    referrerEmail: row.referral_links?.referrer?.email ?? '',
    refereeEmail: row.referral_links?.referee?.email ?? '',
  }));
}

export interface FraudSignalRow {
  referrerId: string;
  referrerEmail: string;
  referrerName: string | null;
  referrerCode: string | null;
  linksTotal: number;
  linksApproved: number;
  linksLast7d: number;
  flagSameAddress: number;
  flagRapidSignup: number;
  flagCapReached: number;
  pointsTotal: number;
  refereesWithoutOrders: number;
}

/** docs/17 §5 — signals, not verdicts. Ordered by the pattern most worth a person's attention. */
export async function listFraudSignals(): Promise<FraudSignalRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('referral_fraud_signals')
    .select('*')
    .order('links_last_7d', { ascending: false })
    .order('links_total', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('listFraudSignals failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    referrerId: String(row.referrer_id ?? ''),
    referrerEmail: String(row.referrer_email ?? ''),
    referrerName: (row.referrer_name as string | null) ?? null,
    referrerCode: (row.referrer_code as string | null) ?? null,
    linksTotal: Number(row.links_total ?? 0),
    linksApproved: Number(row.links_approved ?? 0),
    linksLast7d: Number(row.links_last_7d ?? 0),
    flagSameAddress: Number(row.flag_same_address ?? 0),
    flagRapidSignup: Number(row.flag_rapid_signup ?? 0),
    flagCapReached: Number(row.flag_cap_reached ?? 0),
    pointsTotal: Number(row.points_total ?? 0),
    refereesWithoutOrders: Number(row.referees_without_orders ?? 0),
  }));
}

export interface ReferralLiability {
  /** Points earned but not yet posted to a wallet — what the shop owes and has not paid. */
  unpostedPoints: number;
  unpostedCents: number;
  /** Everything ever awarded, posted or not, net of clawbacks. */
  totalPoints: number;
  totalCents: number;
}

/**
 * docs/17 §5 — the liability figure, surfaced on the dashboard as "Points liability".
 *
 * Worth having on a screen somebody looks at: with monthly posting, points are owed for up to a month
 * before they appear in anybody's balance, so the loyalty balance total understates the real obligation
 * for most of every month.
 */
export async function getReferralLiability(pointValueCents: number): Promise<ReferralLiability> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('referral_earnings')
    .select('points, loyalty_transaction_id');

  if (error) {
    logger.error('getReferralLiability failed', { cause: error.message });
    return { unpostedPoints: 0, unpostedCents: 0, totalPoints: 0, totalCents: 0 };
  }

  let unposted = 0;
  let total = 0;
  for (const row of (data ?? []) as { points: number; loyalty_transaction_id: string | null }[]) {
    total += row.points;
    if (row.loyalty_transaction_id === null) unposted += row.points;
  }

  return {
    unpostedPoints: unposted,
    unpostedCents: unposted * pointValueCents,
    totalPoints: total,
    totalCents: total * pointValueCents,
  };
}
