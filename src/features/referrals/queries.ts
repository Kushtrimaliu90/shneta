import 'server-only';
import { cookies } from 'next/headers';
import encodeQR from '@paulmillr/qr';
import { createClient } from '@/lib/supabase/server';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';
import { REFERRAL_COOKIE_NAME } from '@/lib/constants';
import { siteOrigin } from '@/lib/site';
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

  const [
    { data: sourceRow, error: sourceError },
    { count, error: orderError },
    enabled,
    cookieCode,
  ] = await Promise.all([
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

/**
 * The link a referrer shares. `https://biocode.fit/r/BIO-K7F2M`.
 *
 * Unprefixed, so it opens in Albanian — the default and the language of the prewritten share message.
 * `/en/r/CODE` works identically for anyone who wants to send the English version.
 */
export function referralShareUrl(code: string): string {
  return `${siteOrigin}/r/${code}`;
}

/**
 * The same link as a QR code, for showing somebody in person.
 *
 * A 33×33 GIF as a `data:` URI rather than an inline SVG: the SVG form of this is 18 kB of `<rect>`
 * elements, and this is 2 kB. It is scaled up by CSS with `image-rendering: pixelated`, which keeps the
 * modules square instead of blurring them into something a scanner will not read.
 *
 * Encoded on the server, so the library never enters the browser bundle — the page costs nothing to
 * anybody who does not open it. `data:` is already in the `img-src` allowlist (`next.config.ts`), so
 * this needs no CSP change, and unlike a QR image service it does not hand a customer's invite code to
 * a third party.
 */
export function referralQrDataUri(code: string): string {
  const gif = encodeQR(referralShareUrl(code), 'gif', { ecc: 'medium', border: 2, scale: 1 });
  return `data:image/gif;base64,${Buffer.from(gif).toString('base64')}`;
}

export interface ReferralListEntry {
  /** "Arta B." — a first name and an initial, and never more (docs/17 §6). */
  maskedName: string;
  /** `YYYY-MM`. A month, not a date: a signup date is an identifier. */
  joinedMonth: string;
  status: 'pending' | 'approved' | 'revoked' | 'expired';
  /** Days until the twelve months are up, or null when the link is not running. */
  daysLeft: number | null;
}

export interface ReferralOverview {
  code: string;
  stats: {
    approved: number;
    pending: number;
    expiring30d: number;
    expired: number;
    pointsAllTime: number;
    pointsThisMonth: number;
  };
  referrals: ReferralListEntry[];
}

const STATUSES = ['pending', 'approved', 'revoked', 'expired'] as const;

function toStatus(value: unknown): ReferralListEntry['status'] {
  return (STATUSES as readonly string[]).includes(String(value))
    ? (value as ReferralListEntry['status'])
    : 'pending';
}

/**
 * The referrer's whole view of the programme, from the one RPC allowed to produce it.
 *
 * There is no fallback to a table read here, and there could not be: `referral_links` has no referrer
 * select policy and `referral_earnings` has no customer policy at all (docs/17 §6). If this RPC fails
 * the page shows its error state — which is the correct outcome, because the alternative would be a
 * second read path, and a second read path is how the first one's guarantees get quietly bypassed.
 */
export async function getReferralOverview(): Promise<ReferralOverview | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_referral_overview');

  if (error) {
    logger.error('my_referral_overview failed', { cause: error.message });
    return null;
  }

  const raw = data as {
    code?: string | null;
    stats?: Record<string, number>;
    referrals?: {
      masked_name?: string;
      joined_month?: string;
      status?: string;
      days_left?: number | null;
    }[];
  } | null;

  if (!raw?.code) return null;

  const stats = raw.stats ?? {};
  const num = (key: string) => (typeof stats[key] === 'number' ? stats[key] : 0);

  return {
    code: raw.code,
    stats: {
      approved: num('approved'),
      pending: num('pending'),
      expiring30d: num('expiring_30d'),
      expired: num('expired'),
      pointsAllTime: num('points_all_time'),
      pointsThisMonth: num('points_this_month'),
    },
    referrals: (raw.referrals ?? []).map((row) => ({
      maskedName: row.masked_name ?? 'Klient',
      joinedMonth: row.joined_month ?? '',
      status: toStatus(row.status),
      daysLeft: typeof row.days_left === 'number' ? row.days_left : null,
    })),
  };
}
