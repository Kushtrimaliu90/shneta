import 'server-only';
import { clientEnv } from '@/lib/env.client';
import { sendEmail } from '@/lib/email/send';
import { emailShell, escapeHtml, plainText } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';
import { COPY } from '@/features/referrals/email-copy';

/**
 * docs/17 §7 — the referral emails.
 *
 * ── The rule every one of these obeys ──
 *
 * **Nothing about the referred customer.** Not a name, not an order, not an amount, not a date. §0.2
 * spends the whole design keeping a referrer from learning what their referral bought, and an email is
 * the easiest place to give it away — "Arta just ordered!" reads like a nice touch and is a disclosure.
 * So the subject of every sentence here is the *referrer* and their own points.
 *
 * Fire-and-forget, like every other template in this codebase: a send that throws must never fail the
 * run that triggered it, or a mail outage would stop points being posted.
 */


function copyFor(locale: Locale) {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}

function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

/** The one link every referral email carries. Absolute, from the configured site URL. */
function referralsUrl(locale: Locale): string {
  return `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(locale)}/account/referrals`;
}

/**
 * docs/17 §7 — the monthly summary, sent after the true-up posts.
 *
 * One figure and a link. It deliberately does not break the total down by referral: with one active
 * referral a per-referral figure *is* that person's spend, which is the arithmetic §0.2 cannot hide and
 * therefore refuses to print.
 */
export async function sendReferralMonthlySummary(target: {
  to: string;
  locale: Locale;
  period: string;
  points: number;
  valueLabel: string;
}): Promise<void> {
  const copy = copyFor(target.locale);
  const url = referralsUrl(target.locale);

  const intro = fill(
    target.points < 0 ? copy.monthlyNegativeIntro : copy.monthlyIntro,
    { points: target.points, period: target.period, value: target.valueLabel },
  );

  try {
    await sendEmail({
      to: target.to,
      subject: fill(copy.monthlySubject, { period: target.period }),
      template: 'referral_monthly',
      html: emailShell({
        locale: target.locale,
        heading: copy.monthlyHeading,
        intro: escapeHtml(intro),
        body: `<p style="margin:24px 0 0"><a href="${url}">${escapeHtml(copy.view)}</a></p>`,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.monthlyHeading,
        intro,
        callout: [copy.view, url],
        footer: copy.footer,
      }),
    });
  } catch (cause) {
    logger.warn('Referral monthly summary failed to send', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * docs/17 §7 — T−30 and T−7.
 *
 * The same template for both windows, with the number of days interpolated, because they say the same
 * thing at different volumes. Sending them from one function is also what keeps the two from drifting
 * into contradicting each other about what happens at the end.
 */
export async function sendReferralExpiryNotice(target: {
  to: string;
  locale: Locale;
  days: number;
  /** Rendered by the caller, which knows the locale's date format. */
  dateLabel: string;
  points: number;
}): Promise<void> {
  const copy = copyFor(target.locale);
  const url = referralsUrl(target.locale);

  const intro = fill(copy.expiryIntro, {
    days: target.days,
    date: target.dateLabel,
    points: target.points,
  });

  try {
    await sendEmail({
      to: target.to,
      subject: fill(copy.expirySubject, { days: target.days }),
      template: `referral_expiry_t${target.days}`,
      html: emailShell({
        locale: target.locale,
        heading: copy.expiryHeading,
        intro: escapeHtml(intro),
        body:
          `<p style="margin:16px 0 0">${escapeHtml(copy.expiryTail)}</p>` +
          `<p style="margin:24px 0 0"><a href="${url}">${escapeHtml(copy.view)}</a></p>`,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.expiryHeading,
        intro: `${intro}\n\n${copy.expiryTail}`,
        callout: [copy.view, url],
        footer: copy.footer,
      }),
    });
  } catch (cause) {
    logger.warn('Referral expiry notice failed to send', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * docs/17 §7 — "somebody used your code".
 *
 * The masked name is the only thing said about the person, and it is the same "Arta B." the account page
 * shows. Deliberately says nothing about an order: at this point there may not be one, and once there is,
 * saying so is the disclosure §0.2 exists to prevent.
 */
export async function sendReferralJoined(target: {
  to: string;
  locale: Locale;
  refereeMaskedName: string;
}): Promise<void> {
  const copy = copyFor(target.locale);
  const url = referralsUrl(target.locale);
  const intro = fill(copy.joinedIntro, { name: target.refereeMaskedName });

  await deliver({
    to: target.to,
    locale: target.locale,
    template: 'referral_joined',
    subject: copy.joinedSubject,
    heading: copy.joinedHeading,
    intro,
    tail: copy.joinedTail,
    ctaLabel: copy.view,
    ctaUrl: url,
    footer: copy.footer,
  });
}

/** docs/17 §7 — approved, and therefore earning. */
export async function sendReferralApproved(target: {
  to: string;
  locale: Locale;
  refereeMaskedName: string;
}): Promise<void> {
  const copy = copyFor(target.locale);

  await deliver({
    to: target.to,
    locale: target.locale,
    template: 'referral_approved',
    subject: copy.approvedSubject,
    heading: copy.approvedHeading,
    intro: fill(copy.approvedIntro, { name: target.refereeMaskedName }),
    tail: copy.approvedTail,
    ctaLabel: copy.view,
    ctaUrl: referralsUrl(target.locale),
    footer: copy.footer,
  });
}

/**
 * docs/17 §7 — stopped.
 *
 * Says the two things a person actually wants to know: it has stopped, and the points already earned are
 * not being taken away (docs/17 §1). The admin's reason is **not** included — it is an internal note
 * written for an audit row, in English, by somebody who did not expect a customer to read it.
 */
export async function sendReferralRevoked(target: {
  to: string;
  locale: Locale;
}): Promise<void> {
  const copy = copyFor(target.locale);

  await deliver({
    to: target.to,
    locale: target.locale,
    template: 'referral_revoked',
    subject: copy.revokedSubject,
    heading: copy.revokedHeading,
    intro: copy.revokedIntro,
    tail: copy.revokedTail,
    ctaLabel: copy.view,
    ctaUrl: referralsUrl(target.locale),
    footer: copy.footerRevoked,
  });
}

/**
 * docs/17 §7 — the referee's welcome.
 *
 * The one email in this set that goes to the referred customer. It tells them a referral has been
 * recorded, who by, and where the terms are — because the terms describe what is shared *about them*,
 * and somebody should not have to discover that from a settings page.
 */
export async function sendReferralWelcome(target: {
  to: string;
  locale: Locale;
  referrerMaskedName: string;
}): Promise<void> {
  const copy = copyFor(target.locale);
  const termsUrl = `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(target.locale)}/legal/referral-terms`;

  await deliver({
    to: target.to,
    locale: target.locale,
    template: 'referral_welcome',
    subject: copy.welcomeSubject,
    heading: copy.welcomeHeading,
    intro: fill(copy.welcomeIntro, { name: target.referrerMaskedName }),
    tail: copy.welcomeTail,
    ctaLabel: copy.readTerms,
    ctaUrl: termsUrl,
    footer: copy.footerReferee,
  });
}

/**
 * The shape all four share: a heading, a lead paragraph, one clarifying sentence and one link.
 *
 * Extracted after the third one repeated it. Fire-and-forget in one place rather than four `try`
 * blocks — a send that throws must never fail the cron pass that triggered it, and four copies of that
 * rule is three chances to omit it.
 */
async function deliver(message: {
  to: string;
  locale: Locale;
  template: string;
  subject: string;
  heading: string;
  intro: string;
  tail: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): Promise<void> {
  try {
    await sendEmail({
      to: message.to,
      subject: message.subject,
      template: message.template,
      html: emailShell({
        locale: message.locale,
        heading: message.heading,
        intro: escapeHtml(message.intro),
        body:
          `<p style="margin:16px 0 0">${escapeHtml(message.tail)}</p>` +
          `<p style="margin:24px 0 0"><a href="${message.ctaUrl}">${escapeHtml(message.ctaLabel)}</a></p>`,
        footer: message.footer,
      }),
      text: plainText({
        heading: message.heading,
        intro: `${message.intro}\n\n${message.tail}`,
        callout: [message.ctaLabel, message.ctaUrl],
        footer: message.footer,
      }),
    });
  } catch (cause) {
    logger.warn('Referral email failed to send', {
      template: message.template,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
