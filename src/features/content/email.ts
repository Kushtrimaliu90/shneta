import 'server-only';
import { clientEnv } from '@/lib/env.client';
import { sendEmail } from '@/lib/email/send';
import { emailShell, escapeHtml, plainText } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/05 §16 and docs/08 §5 — the contact acknowledgement, the newsletter double opt-in and
 * the welcome email.
 *
 * Every one is fire-and-forget: a template that throws must never fail the action that
 * triggered it, because the row is already written and the visitor would be told their message
 * or their subscription failed when it did not. `lib/email/send.ts` records the attempt in
 * `email_log` regardless — including as `skipped_no_provider`, which is the current state until
 * Resend has a verified domain (docs/14 §6).
 */

const CONTACT_COPY = {
  sq: {
    subject: 'E morëm mesazhin tënd',
    heading: 'Faleminderit që na shkrove',
    intro:
      'E kemi marrë mesazhin tënd dhe përgjigjemi brenda një dite pune. Nuk ke nevojë ta dërgosh përsëri.',
    footer: 'Ky është një konfirmim automatik nga BIOCODE.',
  },
  en: {
    subject: 'We have your message',
    heading: 'Thanks for writing',
    intro:
      'We have your message and will reply within one working day. There is no need to send it again.',
    footer: 'This is an automatic confirmation from BIOCODE.',
  },
} as const;

export async function sendContactAcknowledgement(target: {
  to: string;
  name: string;
  locale: Locale;
}): Promise<void> {
  try {
    const copy = CONTACT_COPY[target.locale] ?? CONTACT_COPY[DEFAULT_LOCALE];

    await sendEmail({
      to: target.to,
      subject: copy.subject,
      html: emailShell({
        locale: target.locale,
        heading: copy.heading,
        intro: copy.intro,
        body: `<p style="margin:16px 0 0;color:#565E59">${escapeHtml(target.name)}</p>`,
        footer: copy.footer,
      }),
      text: plainText({ heading: copy.heading, intro: copy.intro, footer: copy.footer }),
      template: 'contact_ack',
    });
  } catch (error) {
    logger.error('Contact acknowledgement failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

const NEWSLETTER_COPY = {
  sq: {
    confirmSubject: 'Konfirmo abonimin',
    confirmHeading: 'Një klikim dhe je brenda',
    confirmIntro:
      'Konfirmo adresën për të marrë këshilla praktike dhe njoftime për ofertat. Nëse nuk je ti, thjesht injoroje këtë email.',
    confirmCta: 'Konfirmo abonimin',
    welcomeSubject: 'Mirë se erdhe në BIOCODE',
    welcomeHeading: 'Mirë se erdhe',
    welcomeIntro:
      'Faleminderit që u regjistrove. Do të të shkruajmë vetëm kur kemi diçka të dobishme për të thënë.',
    welcomeCoupon: 'Kodi WELCOME10 ul 10% porosinë tënde të parë.',
    footer: 'E merr këtë email sepse u regjistrove te BIOCODE.',
    unsubscribe: 'Çregjistrohu',
  },
  en: {
    confirmSubject: 'Confirm your subscription',
    confirmHeading: 'One click and you are in',
    confirmIntro:
      'Confirm your address to get practical advice and news about offers. If this was not you, just ignore this email.',
    confirmCta: 'Confirm subscription',
    welcomeSubject: 'Welcome to BIOCODE',
    welcomeHeading: 'Welcome',
    welcomeIntro:
      'Thank you for subscribing. We will only write when we have something useful to say.',
    welcomeCoupon: 'Code WELCOME10 takes 10% off your first order.',
    footer: 'You are receiving this because you subscribed at BIOCODE.',
    unsubscribe: 'Unsubscribe',
  },
} as const;

function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

/**
 * docs/08 §5 — the double opt-in email.
 *
 * The token comes from `newsletter_subscribe`, which mints it inside the database and returns it
 * to the caller only. It is never rendered anywhere a browser could read it: the RPC's own
 * comment says the response must not leak an existing subscriber's state, and the token *is*
 * that state — knowing it would let anyone confirm somebody else's address.
 */
export async function sendNewsletterConfirmation(target: {
  to: string;
  token: string;
  locale: Locale;
}): Promise<void> {
  try {
    const copy = NEWSLETTER_COPY[target.locale] ?? NEWSLETTER_COPY[DEFAULT_LOCALE];
    const url = `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(target.locale)}/newsletter/confirm?token=${encodeURIComponent(target.token)}`;

    await sendEmail({
      to: target.to,
      subject: copy.confirmSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.confirmHeading,
        intro: copy.confirmIntro,
        body: `<p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:#1C4636;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(copy.confirmCta)}</a></p>`,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.confirmHeading,
        intro: copy.confirmIntro,
        callout: [copy.confirmCta, url],
        footer: copy.footer,
      }),
      template: 'newsletter_confirm',
    });
  } catch (error) {
    logger.error('Newsletter confirmation failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/** docs/08 §5 — the welcome email, sent once the address is confirmed. */
export async function sendNewsletterWelcome(target: {
  to: string;
  locale: Locale;
  unsubscribeToken: string;
}): Promise<void> {
  try {
    const copy = NEWSLETTER_COPY[target.locale] ?? NEWSLETTER_COPY[DEFAULT_LOCALE];
    const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
    const path = localePath(target.locale);

    /*
     * docs/08 §5 — every marketing email carries an unsubscribe link, and this is the first
     * marketing email the shop sends.
     *
     * A **token**, not the address. `?email=…` would have been shorter and would have let anyone
     * unsubscribe anyone by editing the URL — invisibly, because unsubscribing is exactly what
     * the link is meant to do. Migration 16 adds a durable per-row token for this.
     */
    const unsubscribe = `${origin}${path}/newsletter/unsubscribe?token=${encodeURIComponent(target.unsubscribeToken)}`;

    await sendEmail({
      to: target.to,
      subject: copy.welcomeSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.welcomeHeading,
        intro: copy.welcomeIntro,
        body: `<p style="margin:16px 0 0;padding:12px 16px;background:#F0F4F1;border-radius:6px;color:#123227"><strong>${escapeHtml(copy.welcomeCoupon)}</strong></p>
               <p style="margin:24px 0 0"><a href="${origin}${path}/shop">${escapeHtml(origin)}</a></p>`,
        footer: `${copy.footer} · <a href="${unsubscribe}">${escapeHtml(copy.unsubscribe)}</a>`,
      }),
      text: plainText({
        heading: copy.welcomeHeading,
        intro: copy.welcomeIntro,
        callout: [copy.welcomeCoupon, `${origin}${path}/shop`],
        footer: `${copy.footer}\n${copy.unsubscribe}: ${unsubscribe}`,
      }),
      template: 'newsletter_welcome',
    });
  } catch (error) {
    logger.error('Newsletter welcome failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
