import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { formatPrice } from '@/lib/money';
import { isLocale, type Locale } from '@/lib/constants';
import {
  sendReferralApproved,
  sendReferralExpiryNotice,
  sendReferralJoined,
  sendReferralMonthlySummary,
  sendReferralRevoked,
  sendReferralWelcome,
} from '@/features/referrals/email';

/**
 * docs/17 §3 — what the daily referral cron does.
 *
 * The service-role client, which is one of the four uses docs/02 §6 allows: a cron has no session, and
 * every function it calls guards itself with `is_service_role()` rather than trusting this file.
 *
 * The arithmetic is all in SQL (migration 60). This module is the schedule and the emails — a loop here
 * that summed points would be a second implementation of the ledger, and the two would disagree the
 * first time a clawback landed mid-month.
 */

/** docs/17 §7 — the two expiry windows, one day wide each so nobody hears twice. */
const EXPIRY_WINDOWS = [30, 7] as const;

export interface ReferralCronSummary {
  expired: number;
  autoApproved: number;
  posted: { period: string; referrers: number; points: number } | null;
  summariesSent: number;
  noticesSent: number;
  /** `joined` sends two messages per link — the referrer's and the referee's welcome. */
  eventEmailsSent: number;
}

function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : 'sq';
}

/**
 * Posting day.
 *
 * The 1st, because "one ledger row per referrer per month" needs a day to be that row's day, and the 1st
 * is the one everybody can predict. `post_referral_earnings` is a true-up and therefore safe to run more
 * often — but running it daily would produce a row a day, which is precisely the timeline §0.2 exists to
 * avoid publishing.
 */
function isPostingDay(now: Date): boolean {
  return now.getUTCDate() === 1;
}

/** The period a posting run belongs to: the month that just finished. */
function periodFor(now: Date): string {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function runReferralCron(now: Date): Promise<ReferralCronSummary> {
  const admin = createAdminClient();

  const summary: ReferralCronSummary = {
    expired: 0,
    autoApproved: 0,
    posted: null,
    summariesSent: 0,
    noticesSent: 0,
    eventEmailsSent: 0,
  };

  /*
   * Expiry first. An expired link must not accrue, must not be auto-approved, and must not be sent a
   * "your invite is ending" notice on the day after it ended.
   */
  const expired = await admin.rpc('expire_referral_links');
  if (expired.error) logger.error('expire_referral_links failed', { cause: expired.error.message });
  else summary.expired = (expired.data as number | null) ?? 0;

  const approved = await admin.rpc('auto_approve_referral_links');
  if (approved.error) {
    logger.error('auto_approve_referral_links failed', { cause: approved.error.message });
  } else {
    summary.autoApproved = (approved.data as number | null) ?? 0;
  }

  if (isPostingDay(now)) {
    const period = periodFor(now);
    const posted = await admin.rpc('post_referral_earnings', { p_period: period });

    if (posted.error) {
      logger.error('post_referral_earnings failed', { cause: posted.error.message });
    } else {
      const result = posted.data as { period: string; referrers: number; points: number } | null;
      summary.posted = result ?? { period, referrers: 0, points: 0 };
      summary.summariesSent = await sendMonthlySummaries(period);
    }
  }

  for (const days of EXPIRY_WINDOWS) {
    summary.noticesSent += await sendExpiryNotices(days);
  }

  /*
   * The event emails last, and `approved` after `joined`, so a link created and auto-approved in the same
   * run is announced in the order it happened rather than backwards.
   */
  for (const kind of ['joined', 'approved', 'revoked'] as const) {
    summary.eventEmailsSent += await sendEventEmails(kind);
  }

  return summary;
}

interface EmailSweepRow {
  link_id: string;
  referrer_email: string;
  referrer_locale: string;
  referee_email: string;
  referee_locale: string;
  referee_masked_name: string;
  referrer_masked_name: string;
}

/**
 * docs/17 §7 — the sweep.
 *
 * The order inside the loop is load-bearing: **send, then stamp.** Stamping first would turn a transient
 * Resend failure into a permanently missing email, because the row would never be selected again. This
 * way a failure means it goes out tomorrow — the send itself is fire-and-forget and never throws, so the
 * stamp is reached whenever the attempt was made.
 *
 * `joined` sends two messages from one row, which is why they share a flag: the referrer being told and
 * the referee being welcomed are one event, and letting them drift apart would mean somebody hears they
 * were referred by a person who has not yet heard they referred them.
 */
async function sendEventEmails(kind: 'joined' | 'approved' | 'revoked'): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('referral_links_needing_email', { p_kind: kind });

  if (error) {
    logger.error('referral_links_needing_email failed', { kind, cause: error.message });
    return 0;
  }

  let sent = 0;

  for (const row of (data ?? []) as EmailSweepRow[]) {
    const referrerLocale = toLocale(row.referrer_locale);

    if (kind === 'joined') {
      await sendReferralJoined({
        to: row.referrer_email,
        locale: referrerLocale,
        refereeMaskedName: row.referee_masked_name,
      });
      await sendReferralWelcome({
        to: row.referee_email,
        locale: toLocale(row.referee_locale),
        referrerMaskedName: row.referrer_masked_name,
      });
      sent += 2;
    } else if (kind === 'approved') {
      await sendReferralApproved({
        to: row.referrer_email,
        locale: referrerLocale,
        refereeMaskedName: row.referee_masked_name,
      });
      sent += 1;
    } else {
      /*
       * The admin's reason is deliberately not passed to the template. It is an internal note written
       * for an audit row, in English, by somebody who did not expect a customer to read it.
       */
      await sendReferralRevoked({ to: row.referrer_email, locale: referrerLocale });
      sent += 1;
    }

    const marked = await admin.rpc('mark_referral_emailed', {
      p_link_id: row.link_id,
      p_kind: kind,
    });
    if (marked.error) {
      /*
       * Logged loudly, because this is the one failure that repeats: the email went out and the flag did
       * not, so tomorrow's run sends it again. Better a duplicate than a silence, but somebody should see
       * it.
       */
      logger.error('mark_referral_emailed failed — this email will repeat', {
        kind,
        linkId: row.link_id,
        cause: marked.error.message,
      });
    }
  }

  return sent;
}

/**
 * The monthly summary email, one per referrer who was actually paid.
 *
 * Read back from `loyalty_transactions` rather than from the posting function's return value, because
 * the note carries the period and the row is the record of what happened — so a referrer who was skipped
 * (owed nothing, or floored to zero) is not emailed about points they did not receive.
 */
async function sendMonthlySummaries(period: string): Promise<number> {
  const admin = createAdminClient();
  const note = `Referral earnings — ${period}`;

  const { data, error } = await admin
    .from('loyalty_transactions')
    .select('points, profiles ( email, preferred_locale )')
    .eq('note', note)
    .in('reason', ['referral', 'referral_clawback']);

  if (error) {
    logger.error('referral summaries lookup failed', { cause: error.message });
    return 0;
  }

  const pointValue = await pointValueCents();
  let sent = 0;

  for (const row of (data ?? []) as unknown as {
    points: number;
    profiles: { email: string; preferred_locale: string } | null;
  }[]) {
    if (!row.profiles?.email) continue;
    const locale = toLocale(row.profiles.preferred_locale);

    await sendReferralMonthlySummary({
      to: row.profiles.email,
      locale,
      period,
      points: row.points,
      valueLabel: formatPrice(Math.abs(row.points) * pointValue, locale),
    });
    sent += 1;
  }

  return sent;
}

/** docs/17 §7 — T−30 and T−7, from the one-day-wide window defined in SQL. */
async function sendExpiryNotices(days: number): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('referral_links_expiring', { p_days: days });

  if (error) {
    logger.error('referral_links_expiring failed', { days, cause: error.message });
    return 0;
  }

  let sent = 0;
  for (const row of (data ?? []) as {
    referrer_email: string;
    referrer_locale: string;
    expires_at: string;
    points_earned: number;
  }[]) {
    if (!row.referrer_email) continue;
    const locale = toLocale(row.referrer_locale);

    await sendReferralExpiryNotice({
      to: row.referrer_email,
      locale,
      days,
      /*
       * `sq-AL` has no widely-supported ICU data in every Node build, and a date that renders as
       * "Invalid Date" in an email is worse than an unambiguous ISO one. `en-GB` gives `05/08/2026`,
       * which is the order both locales read dates in.
       */
      dateLabel: new Date(row.expires_at).toLocaleDateString('en-GB', { timeZone: 'UTC' }),
      points: row.points_earned,
    });
    sent += 1;
  }

  return sent;
}

async function pointValueCents(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.from('settings').select('value').eq('key', 'loyalty').maybeSingle();
  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const raw = value.point_value_cents;
  return typeof raw === 'number' && raw > 0 ? raw : 1;
}
