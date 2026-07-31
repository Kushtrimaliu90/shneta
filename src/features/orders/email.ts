import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env.client';
import { formatPrice } from '@/lib/money';
import { sendEmail } from '@/lib/email/send';
import {
  calloutBlock,
  emailShell,
  escapeHtml,
  factRow,
  factTable,
  plainText,
} from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/08 §6 / docs/07 §12 — the order lifecycle emails: confirmed, shipped, delivered,
 * cancelled, refunded.
 *
 * Read with the **service client**, and that is a deliberate exception worth stating. Every
 * other order read in this feature goes through the SSR client so RLS applies. These do not,
 * because an email must render for a *guest* order — no session, no `auth.uid()`, nothing for
 * a policy to match. docs/02 §6 lists email dispatch among the sanctioned service-role uses.
 *
 * Every send is fire-and-forget from the caller's perspective (docs/07 §12): a template that
 * throws must never roll back a shipment that has already left the building. These functions
 * therefore swallow their own failures and log them, and `lib/email/send.ts` records the
 * attempt in `email_log` either way — including as `skipped_no_provider` when RESEND_API_KEY
 * is absent, which is the current state (docs/14 §6).
 *
 * The email renders in `order.locale`, never the operator's. The customer chose that language.
 */

type Template =
  'order_confirmed' | 'order_shipped' | 'order_delivered' | 'order_cancelled' | 'refund_issued';

interface OrderForEmail {
  order_number: string;
  email: string;
  locale: string;
  total_cents: number;
  shipping_method: { min_days?: number; max_days?: number } | null;
}

/**
 * Extra facts a specific template needs and the order row does not carry — the tracking number
 * a shipment was just created with, the reason typed into a cancel dialog.
 */
export interface LifecycleContext {
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  reason?: string;
  amountCents?: number;
}

const COPY = {
  sq: {
    order_confirmed: {
      subject: (n: string) => `Porosia ${n} është konfirmuar`,
      heading: 'Porosia u konfirmua',
      intro: 'Porosia jonë është konfirmuar dhe po e përgatisim për dërgesë.',
    },
    order_shipped: {
      subject: (n: string) => `Porosia ${n} është në rrugë`,
      heading: 'Porosia u dërgua',
      intro: 'Porosia juaj i është dorëzuar korrierit. Mund ta gjurmoni me numrin më poshtë.',
    },
    order_delivered: {
      subject: (n: string) => `Porosia ${n} u dorëzua`,
      heading: 'Porosia u dorëzua',
      intro: 'Faleminderit! Shpresojmë t’ju shërbejë mirë.',
    },
    order_cancelled: {
      subject: (n: string) => `Porosia ${n} u anulua`,
      heading: 'Porosia u anulua',
      intro: 'Porosia juaj u anulua. Nuk paguani asgjë.',
    },
    refund_issued: {
      subject: (n: string) => `Rimbursim për porosinë ${n}`,
      heading: 'Rimbursimi u lëshua',
      intro: 'Kemi lëshuar një rimbursim për porosinë tuaj.',
    },
    labels: {
      orderNumber: 'Numri i porosisë',
      carrier: 'Korrieri',
      tracking: 'Numri i gjurmimit',
      reason: 'Arsyeja',
      amount: 'Vlera e rimbursuar',
      eta: (min: number, max: number) => `Pritet brenda ${min}–${max} ditësh.`,
      codHeading: 'Pagesa në dorëzim',
      codBody: (amount: string) => `Përgatit ${amount} në para të gatshme për korrierin.`,
      refundHeading: 'Si e marrni rimbursimin',
      // COD means there is no card to reverse — say so plainly rather than leave them waiting.
      refundBody:
        'Pagesa ishte në dorëzim, ndaj do të kontaktojmë për t’u marrë vesh se si t’ju kthejmë vlerën.',
      track: 'Gjurmo porosinë me numrin e porosisë dhe email-in tuaj:',
      questions: 'Për çdo pyetje, përgjigju këtij email-i.',
    },
  },
  en: {
    order_confirmed: {
      subject: (n: string) => `Order ${n} is confirmed`,
      heading: 'Your order is confirmed',
      intro: 'We have confirmed your order and are preparing it for delivery.',
    },
    order_shipped: {
      subject: (n: string) => `Order ${n} is on its way`,
      heading: 'Your order has shipped',
      intro: 'Your order is with the courier. You can track it with the number below.',
    },
    order_delivered: {
      subject: (n: string) => `Order ${n} was delivered`,
      heading: 'Your order was delivered',
      intro: 'Thank you! We hope it serves you well.',
    },
    order_cancelled: {
      subject: (n: string) => `Order ${n} was cancelled`,
      heading: 'Your order was cancelled',
      intro: 'Your order has been cancelled. You owe nothing.',
    },
    refund_issued: {
      subject: (n: string) => `Refund for order ${n}`,
      heading: 'Your refund has been issued',
      intro: 'We have issued a refund on your order.',
    },
    labels: {
      orderNumber: 'Order number',
      carrier: 'Courier',
      tracking: 'Tracking number',
      reason: 'Reason',
      amount: 'Refunded amount',
      eta: (min: number, max: number) => `Expected within ${min}–${max} days.`,
      codHeading: 'Cash on delivery',
      codBody: (amount: string) => `Please have ${amount} in cash ready for the courier.`,
      refundHeading: 'How you receive the refund',
      refundBody:
        'Payment was on delivery, so we will contact you to arrange how to return the amount.',
      track: 'Track this order any time with the order number and your email:',
      questions: 'Any questions — just reply to this email.',
    },
  },
} as const;

/**
 * Sends one lifecycle email.
 *
 * Exported as a single function with a template discriminator rather than five near-identical
 * exports: everything except a few lines of copy and one facts table is shared, and the actions
 * pick a template by name anyway.
 */
export async function sendOrderLifecycleEmail(
  orderId: string,
  template: Template,
  context: LifecycleContext = {},
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from('orders')
      .select('order_number, email, locale, total_cents, shipping_method')
      .eq('id', orderId)
      .single();

    if (error || !data) {
      logger.error('Cannot send lifecycle email — order not readable', {
        orderId,
        template,
        cause: error?.message,
      });
      return;
    }

    const order = data as unknown as OrderForEmail;
    const locale: Locale = order.locale === 'en' ? 'en' : DEFAULT_LOCALE;
    const copy = COPY[locale];
    const t = copy[template];
    const labels = copy.labels;
    const money = (cents: number) => formatPrice(cents, locale);
    const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
    const lookupUrl = locale === 'en' ? `${origin}/en/order-lookup` : `${origin}/order-lookup`;

    /*
     * Facts are collected as label/value pairs and rendered twice — once as HTML rows, once as
     * text lines. Building the plain-text part from the same data rather than stripping tags
     * out of the HTML is what keeps the two saying the same thing.
     *
     * `htmlValue` carries markup (a tracking link); `textValue` never does.
     */
    const facts: { label: string; htmlValue: string; textValue: string }[] = [
      {
        label: labels.orderNumber,
        htmlValue: escapeHtml(order.order_number),
        textValue: order.order_number,
      },
    ];
    let callout: [string, string] | null = null;

    if (template === 'order_confirmed') {
      const min = order.shipping_method?.min_days;
      const max = order.shipping_method?.max_days;
      if (min != null && max != null) {
        facts.push({ label: labels.eta(min, max), htmlValue: '', textValue: '' });
      }
      callout = [labels.codHeading, labels.codBody(money(order.total_cents))];
    }

    if (template === 'order_shipped') {
      if (context.carrier) {
        facts.push({
          label: labels.carrier,
          htmlValue: escapeHtml(context.carrier),
          textValue: context.carrier,
        });
      }
      if (context.trackingNumber) {
        /*
         * Linked when the courier publishes a URL, plain otherwise. Not every Kosovo courier
         * has a tracking page, and a dead link is worse than a number to quote on the phone.
         */
        facts.push({
          label: labels.tracking,
          htmlValue: context.trackingUrl
            ? `<a href="${escapeHtml(context.trackingUrl)}" style="color:#1C4636">${escapeHtml(context.trackingNumber)}</a>`
            : escapeHtml(context.trackingNumber),
          textValue: context.trackingUrl
            ? `${context.trackingNumber} — ${context.trackingUrl}`
            : context.trackingNumber,
        });
      }
      callout = [labels.codHeading, labels.codBody(money(order.total_cents))];
    }

    if (template === 'order_cancelled' && context.reason) {
      facts.push({
        label: labels.reason,
        htmlValue: escapeHtml(context.reason),
        textValue: context.reason,
      });
    }

    if (template === 'refund_issued') {
      if (context.amountCents != null) {
        const amount = money(context.amountCents);
        facts.push({ label: labels.amount, htmlValue: amount, textValue: amount });
      }
      if (context.reason) {
        facts.push({
          label: labels.reason,
          htmlValue: escapeHtml(context.reason),
          textValue: context.reason,
        });
      }
      // docs/07 §7.3 — the email must state the method, and for COD there is no card to reverse.
      callout = [labels.refundHeading, labels.refundBody];
    }

    const textFooter = `${labels.track} ${lookupUrl}\n${labels.questions}`;

    const html = emailShell({
      locale,
      heading: t.heading,
      intro: t.intro,
      body: `${factTable(facts.map((f) => factRow(f.label, f.htmlValue)).join(''))}${
        callout ? calloutBlock(callout[0], callout[1]) : ''
      }`,
      footer: `${labels.track} <a href="${lookupUrl}" style="color:#1C4636">${lookupUrl}</a><br />${labels.questions}`,
    });

    await sendEmail({
      to: order.email,
      subject: t.subject(order.order_number),
      html,
      text: plainText({
        heading: t.heading,
        intro: t.intro,
        facts: facts.map((f) => [f.label, f.textValue] as [string, string]),
        callout: callout ?? undefined,
        footer: textFooter,
      }),
      template,
      orderId,
    });
  } catch (cause) {
    // docs/07 §12 — a failed email never fails the commerce action that triggered it.
    logger.error('Lifecycle email threw', {
      orderId,
      template,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** Maps an order status to the email it should trigger, or null when there is none. */
export function templateForStatus(status: string): Template | null {
  switch (status) {
    case 'confirmed':
      return 'order_confirmed';
    case 'shipped':
      return 'order_shipped';
    case 'delivered':
      return 'order_delivered';
    case 'cancelled':
      return 'order_cancelled';
    default:
      // `processing` is an internal step with nothing to tell the customer — sending "we are
      // now picking your items" is noise that trains people to ignore the useful ones.
      return null;
  }
}
