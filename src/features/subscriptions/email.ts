import 'server-only';
import { clientEnv } from '@/lib/env.client';
import { sendEmail } from '@/lib/email/send';
import { calloutBlock, emailShell, escapeHtml, plainText } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/07 §8.2 — the four emails the renewal engine sends.
 *
 * Fire-and-forget, like every other template in this codebase: a send that throws must never
 * fail the run that triggered it, or a mail outage would stop the shop generating orders.
 *
 * The notice is the one that matters. Its whole purpose is to let somebody stop a delivery
 * **without signing in**, so the skip and pause links carry one-shot tokens (migration 17).
 * An email that says "log in to manage your subscription" is an email nobody acts on, and the
 * delivery arrives anyway.
 */

const COPY = {
  sq: {
    noticeSubject: 'Dërgesa jote po përgatitet',
    noticeHeading: 'Dërgesa jote po përgatitet',
    noticeIntro:
      'Porosia e radhës nga abonimi yt niset më {date}. Nuk ke nevojë të bësh asgjë — paguan në dorëzim, si zakonisht.',
    noticeCallout: 'Nuk të duhet këtë herë?',
    skip: 'Kalo këtë dërgesë',
    pause: 'Ndalo abonimin',
    orderSubject: 'Porosia jote e abonimit u krijua',
    orderHeading: 'Porosia u krijua',
    orderIntro: 'Kemi krijuar porosinë tënde të radhës nga abonimi. Paguan në dorëzim.',
    skippedSubject: 'Kaluam këtë dërgesë',
    skippedHeading: 'Kaluam këtë dërgesë',
    skippedIntro:
      'Nuk mundëm ta përgatisim dërgesën e radhës sepse produktet nuk janë të disponueshme për momentin. Nuk të kemi ngarkuar asgjë dhe provojmë përsëri në ciklin tjetër.',
    pausedSubject: 'Abonimi u ndal përkohësisht',
    pausedHeading: 'E ndalëm abonimin',
    pausedIntro:
      'Tri dërgesa radhazi nuk u krijuan dot, ndaj e ndalëm abonimin që të mos vazhdojë të dështojë. Mund ta rifillosh me një klikim nga llogaria jote.',
    manage: 'Menaxho abonimin',
    footer: 'E merr këtë email sepse ke një abonim aktiv te BIOCODE.',
  },
  en: {
    noticeSubject: 'Your delivery is being prepared',
    noticeHeading: 'Your delivery is being prepared',
    noticeIntro:
      'Your next subscription order goes out on {date}. There is nothing to do — you pay on delivery, as usual.',
    noticeCallout: 'Not needed this time?',
    skip: 'Skip this delivery',
    pause: 'Pause the subscription',
    orderSubject: 'Your subscription order is placed',
    orderHeading: 'Order placed',
    orderIntro: 'We have created your next subscription order. You pay on delivery.',
    skippedSubject: 'We skipped this delivery',
    skippedHeading: 'We skipped this delivery',
    skippedIntro:
      'We could not prepare your next delivery because the products are unavailable right now. You have not been charged, and we will try again next cycle.',
    pausedSubject: 'Your subscription is paused',
    pausedHeading: 'We paused your subscription',
    pausedIntro:
      'Three deliveries in a row could not be created, so we paused the subscription rather than let it keep failing. You can restart it in one click from your account.',
    manage: 'Manage subscription',
    footer: 'You are receiving this because you have an active subscription at BIOCODE.',
  },
} as const;

function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

function copyFor(locale: Locale) {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}

/** docs/07 §8.2 — T−3, with one-click skip and pause. */
export async function sendSubscriptionNotice(target: {
  to: string;
  locale: Locale;
  deliveryDate: string;
  skipToken: string;
  pauseToken: string;
}): Promise<void> {
  try {
    const copy = copyFor(target.locale);
    const origin = `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(target.locale)}`;
    const skipUrl = `${origin}/subscriptions/action?token=${encodeURIComponent(target.skipToken)}`;
    const pauseUrl = `${origin}/subscriptions/action?token=${encodeURIComponent(target.pauseToken)}`;
    const intro = copy.noticeIntro.replace('{date}', target.deliveryDate);

    await sendEmail({
      to: target.to,
      subject: copy.noticeSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.noticeHeading,
        intro,
        body: calloutBlock(
          copy.noticeCallout,
          `<a href="${skipUrl}">${escapeHtml(copy.skip)}</a> &nbsp;·&nbsp; <a href="${pauseUrl}">${escapeHtml(copy.pause)}</a>`,
        ),
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.noticeHeading,
        intro,
        callout: [copy.skip, skipUrl],
        footer: `${copy.pause}: ${pauseUrl}\n${copy.footer}`,
      }),
      template: 'subscription_notice',
    });
  } catch (error) {
    logger.error('Subscription notice failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendSubscriptionOrder(target: {
  to: string;
  locale: Locale;
  orderNumber: string;
  nextDate: string;
}): Promise<void> {
  try {
    const copy = copyFor(target.locale);
    const origin = `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(target.locale)}`;

    await sendEmail({
      to: target.to,
      subject: copy.orderSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.orderHeading,
        intro: copy.orderIntro,
        body: `<p style="margin:16px 0 0"><strong data-numeric>${escapeHtml(target.orderNumber)}</strong></p>
               <p style="margin:16px 0 0"><a href="${origin}/account/subscriptions">${escapeHtml(copy.manage)}</a></p>`,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.orderHeading,
        intro: copy.orderIntro,
        callout: [target.orderNumber, `${origin}/account/subscriptions`],
        footer: copy.footer,
      }),
      template: 'subscription_order',
    });
  } catch (error) {
    logger.error('Subscription order email failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendSubscriptionSkipped(target: {
  to: string;
  locale: Locale;
  reason: string;
}): Promise<void> {
  try {
    const copy = copyFor(target.locale);

    await sendEmail({
      to: target.to,
      subject: copy.skippedSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.skippedHeading,
        intro: copy.skippedIntro,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.skippedHeading,
        intro: copy.skippedIntro,
        footer: copy.footer,
      }),
      template: 'subscription_skipped',
    });
    logger.info('Subscription cycle skipped', { reason: target.reason });
  } catch (error) {
    logger.error('Subscription skipped email failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendSubscriptionPaused(target: {
  to: string;
  locale: Locale;
}): Promise<void> {
  try {
    const copy = copyFor(target.locale);
    const origin = `${clientEnv.NEXT_PUBLIC_SITE_URL}${localePath(target.locale)}`;

    await sendEmail({
      to: target.to,
      subject: copy.pausedSubject,
      html: emailShell({
        locale: target.locale,
        heading: copy.pausedHeading,
        intro: copy.pausedIntro,
        body: `<p style="margin:24px 0 0"><a href="${origin}/account/subscriptions">${escapeHtml(copy.manage)}</a></p>`,
        footer: copy.footer,
      }),
      text: plainText({
        heading: copy.pausedHeading,
        intro: copy.pausedIntro,
        callout: [copy.manage, `${origin}/account/subscriptions`],
        footer: copy.footer,
      }),
      template: 'subscription_paused',
    });
  } catch (error) {
    logger.error('Subscription paused email failed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
