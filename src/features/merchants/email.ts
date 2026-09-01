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
 * docs/16 §7 — the merchant lifecycle emails.
 *
 * ── The rule that shapes every template here ──
 *
 * **Merchants never receive the customer's email and never message customers** (§3, and clause 1 of the
 * terms: the sale is BioCode↔customer and the merchant is a supplier). So a merchant email says what the
 * merchant has to *do*, and links into the portal for anything else. It never contains a customer name, a
 * customer address, an order total, or a way to reply to a shopper — and the portal is where the address
 * appears, once assigned, because that page is behind a session.
 *
 * ── Service client, and why it belongs on the docs/02 §6 list ──
 *
 * These read `merchants` and `order_fulfilments` with no session at all: they are called from cron jobs,
 * from webhooks, and from actions taken by the *other* party. There is nothing for RLS to match against,
 * which is precisely the sanctioned case for the service client.
 *
 * Every send is fire-and-forget: a template that throws must never roll back a routing decision that has
 * already happened. These functions swallow their own failures and log them, and `sendEmail` records the
 * attempt in `email_log` either way.
 *
 * ── Language ──
 *
 * A merchant is a Kosovo business, so the default is Albanian. `merchants` has no locale column and adding
 * one for six emails is a migration for a preference nobody has expressed — so it is Albanian unless the
 * merchant's contact profile says otherwise, which is the same rule the portal follows.
 */

type Template =
  | 'merchant_application_received'
  | 'merchant_approved'
  | 'merchant_rejected'
  | 'merchant_info_requested'
  | 'merchant_fulfilment_assigned'
  | 'merchant_fulfilment_reminder'
  | 'merchant_offer_approved'
  | 'merchant_offer_rejected'
  | 'merchant_payout_ready'
  | 'merchant_proposal_decided';

const STORE = 'BioCode';

function portalUrl(path: string): string {
  const base = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

/**
 * Copy for both locales, in one object per template.
 *
 * Not in `src/i18n/messages` and that is deliberate: those are loaded by next-intl into a request scope,
 * and these render from a cron job with no request. Keeping email copy beside the sender also means a
 * change to a subject line and its body happen in one diff.
 */
const COPY: Record<
  Template,
  Record<
    Locale,
    {
      subject: (context: Record<string, string>) => string;
      heading: (context: Record<string, string>) => string;
      intro: (context: Record<string, string>) => string;
      action?: string;
    }
  >
> = {
  merchant_application_received: {
    sq: {
      subject: () => `${STORE} — aplikimi u pranua`,
      heading: () => 'E marrëm aplikimin tënd',
      intro: () =>
        'Faleminderit. Do të shqyrtojmë të dhënat dhe dokumentet. Hapi tjetër është ngarkimi i certifikatës së regjistrimit në portal, nëse nuk e ke bërë ende — pa të nuk mund të miratojmë.',
      action: 'Hap portalin',
    },
    en: {
      subject: () => `${STORE} — we have your application`,
      heading: () => 'We have your application',
      intro: () =>
        'Thank you. We will review your details and documents. The next step is uploading your registration certificate in the portal if you have not already — we cannot approve without it.',
      action: 'Open the portal',
    },
  },

  merchant_approved: {
    sq: {
      subject: () => `${STORE} — u miratove si shitës`,
      heading: () => 'Aplikimi u miratua',
      intro: () =>
        'Tani mund të shtosh oferta për produktet e BioCode-it. Komisioni dhe marrëveshja për transportin janë më poshtë — të njëjtat i shikon gjithmonë në portal.',
      action: 'Shto ofertën e parë',
    },
    en: {
      subject: () => `${STORE} — you are approved`,
      heading: () => 'Your application is approved',
      intro: () =>
        'You can now add offers against BioCode products. Your commission and shipping arrangement are below — the same figures are always in the portal.',
      action: 'Add your first offer',
    },
  },

  merchant_rejected: {
    sq: {
      subject: () => `${STORE} — aplikimi nuk u miratua`,
      heading: () => 'Aplikimi nuk u miratua',
      intro: () =>
        'Arsyeja është më poshtë. Mund të aplikosh sërish pasi rregullohet ajo që mungon.',
    },
    en: {
      subject: () => `${STORE} — your application was not approved`,
      heading: () => 'Your application was not approved',
      intro: () => 'The reason is below. You are welcome to apply again once it has been sorted.',
    },
  },

  merchant_info_requested: {
    sq: {
      subject: () => `${STORE} — kërkohen të dhëna shtesë`,
      heading: () => 'Na duhet diçka më shumë',
      intro: () =>
        'Aplikimi qëndron në shqyrtim. Ajo që mungon është më poshtë; sapo ta dërgosh, vazhdojmë.',
      action: 'Hap portalin',
    },
    en: {
      subject: () => `${STORE} — we need something more`,
      heading: () => 'We need something more',
      intro: () =>
        'Your application is still under review. What is missing is below; once you send it we will carry on.',
      action: 'Open the portal',
    },
  },

  merchant_fulfilment_assigned: {
    sq: {
      subject: (context) => `${STORE} — porosi e re për ${context.orderNumber}`,
      heading: () => 'Një porosi pret përgjigjen tënde',
      intro: () =>
        'BioCode ka drejtuar një porosi te ti. Pranoje nëse mund ta dërgosh, ose refuzoje sa më shpejt që t’ia kalojmë një shitësi tjetër. Afati është 24 orë.',
      action: 'Shiko porosinë',
    },
    en: {
      subject: (context) => `${STORE} — new order ${context.orderNumber}`,
      heading: () => 'An order is waiting on your answer',
      intro: () =>
        'BioCode has routed an order to you. Accept it if you can ship it, or decline quickly so we can route it elsewhere. The window is 24 hours.',
      action: 'Open the order',
    },
  },

  merchant_fulfilment_reminder: {
    sq: {
      subject: (context) => `${STORE} — porosia ${context.orderNumber} pret ende`,
      heading: () => 'Kjo porosi pret ende përgjigjen tënde',
      intro: () =>
        'Afati i pranimit është 24 orë dhe kjo porosi e ka kaluar. Pranoje ose refuzoje — një porosi e lënë pa përgjigje mban klientin në pritje dhe ul vlerësimin tënd.',
      action: 'Përgjigju tani',
    },
    en: {
      subject: (context) => `${STORE} — order ${context.orderNumber} is still waiting`,
      heading: () => 'This order is still waiting on you',
      intro: () =>
        'The acceptance window is 24 hours and this order has passed it. Accept or decline — an unanswered order keeps a customer waiting and lowers your rating.',
      action: 'Answer now',
    },
  },

  merchant_offer_approved: {
    sq: {
      subject: () => `${STORE} — oferta u miratua`,
      heading: () => 'Oferta u miratua',
      intro: () =>
        'Oferta është tani në dyqan. Stoku i BioCode-it ka prioritet ku ekziston; përndryshe fiton oferta më e lirë në gjendje. Në portal shikon nëse është në kutinë e blerjes.',
      action: 'Shiko ofertat',
    },
    en: {
      subject: () => `${STORE} — your offer is approved`,
      heading: () => 'Your offer is approved',
      intro: () =>
        'It is live in the shop now. BioCode stock takes priority wherever it exists; otherwise the cheapest in-stock offer wins. The portal shows whether yours is in the buy box.',
      action: 'View your offers',
    },
  },

  merchant_offer_rejected: {
    sq: {
      subject: () => `${STORE} — oferta nuk u miratua`,
      heading: () => 'Oferta nuk u miratua',
      intro: () =>
        'Arsyeja është më poshtë. Ndryshoje dhe dërgoje sërish për shqyrtim — nuk ka nevojë të krijosh ofertë të re.',
      action: 'Ndrysho ofertën',
    },
    en: {
      subject: () => `${STORE} — your offer was not approved`,
      heading: () => 'Your offer was not approved',
      intro: () =>
        'The reason is below. Change it and resubmit for review — there is no need to create a new offer.',
      action: 'Edit the offer',
    },
  },

  merchant_payout_ready: {
    sq: {
      subject: (context) => `${STORE} — pasqyra ${context.period}`,
      heading: () => 'Pasqyra e shlyerjes është gati',
      intro: () =>
        'Kjo është pasqyra për periudhën e mbyllur. Çdo rresht e ka porosinë përkatëse. Nëse diçka nuk përputhet me librat e tua, shkruaji BioCode-it brenda 14 ditëve.',
      action: 'Shiko pasqyrën',
    },
    en: {
      subject: (context) => `${STORE} — statement ${context.period}`,
      heading: () => 'Your settlement statement is ready',
      intro: () =>
        'This is the statement for the period that has just closed. Every line names its order. If something does not match your own books, tell BioCode within 14 days.',
      action: 'View the statement',
    },
  },

  merchant_proposal_decided: {
    sq: {
      subject: (context) => `${STORE} — propozimi për ${context.productName}`,
      heading: () => 'Përgjigje për propozimin tënd',
      intro: () => 'Vendimi dhe shënimi i shqyrtuesit janë më poshtë.',
      action: 'Shiko propozimet',
    },
    en: {
      subject: (context) => `${STORE} — your proposal for ${context.productName}`,
      heading: () => 'An answer on your proposal',
      intro: () => 'The decision and the reviewer’s note are below.',
      action: 'View your proposals',
    },
  },
};

const FOOTER: Record<Locale, string> = {
  sq: `Ky email i dërgohet shitësve të ${STORE}. Të gjitha detajet dhe veprimet janë në portalin e shitësit.`,
  en: `This email goes to ${STORE} sellers. Every detail and every action lives in the seller portal.`,
};

interface MerchantRecipient {
  id: string;
  displayName: string;
  contactEmail: string;
  locale: Locale;
}

/**
 * Who to write to, and in which language.
 *
 * The **application contact address**, not the portal account's — they are usually the same, but the
 * contact is the address the applicant chose to be reached at and is the one that exists before an account
 * does. Locale comes from the linked profile when there is one, defaulting to Albanian.
 */
async function recipient(merchantId: string): Promise<MerchantRecipient | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('merchants')
      .select('id, display_name, contact_email, merchant_users ( profiles ( preferred_locale ) )')
      .eq('id', merchantId)
      .maybeSingle();

    if (error || !data) {
      logger.error('merchant email recipient lookup failed', {
        merchantId,
        cause: error?.message,
      });
      return null;
    }

    const row = data as unknown as {
      id: string;
      display_name: string;
      contact_email: string;
      merchant_users: { profiles: { preferred_locale: string | null } | null }[];
    };

    const profileLocale = row.merchant_users
      .map((link) => link.profiles?.preferred_locale)
      .find((value): value is string => value === 'sq' || value === 'en');

    return {
      id: row.id,
      displayName: row.display_name,
      contactEmail: row.contact_email,
      locale: (profileLocale ?? DEFAULT_LOCALE) as Locale,
    };
  } catch (error) {
    logger.error('merchant email recipient threw', {
      merchantId,
      cause: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface SendOptions {
  merchantId: string;
  template: Template;
  /** Values interpolated into the subject and heading. Escaped before rendering. */
  context?: Record<string, string>;
  /**
   * Label/value pairs, unescaped.
   *
   * Tuples rather than pre-rendered HTML, because the same facts have to appear in the plain-text part —
   * and two call sites building the same rows twice is how the text alternative of an email drifts from
   * the HTML one until nobody notices it is wrong.
   */
  facts?: [string, string][];
  /** A callout, typically a reviewer's note or an amount. */
  callout?: { title: string; body: string };
  /** Portal path the action button links to. */
  actionPath?: string;
}

/**
 * Renders and sends one merchant email.
 *
 * One function for all ten templates, because they differ only in copy, facts and a link — and ten
 * near-identical send functions is ten places for the footer to drift.
 */
async function send(options: SendOptions): Promise<void> {
  try {
    const target = await recipient(options.merchantId);
    if (!target) return;

    const copy = COPY[options.template][target.locale];
    const context = options.context ?? {};

    const escapedContext = Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, escapeHtml(value)]),
    );

    const heading = copy.heading(escapedContext);
    const intro = copy.intro(escapedContext);

    const bodyParts: string[] = [];
    if (options.facts?.length) {
      bodyParts.push(
        factTable(
          options.facts
            .map(([label, value]) => factRow(escapeHtml(label), escapeHtml(value)))
            .join(''),
        ),
      );
    }
    if (options.callout) {
      bodyParts.push(
        calloutBlock(escapeHtml(options.callout.title), escapeHtml(options.callout.body)),
      );
    }
    if (options.actionPath && copy.action) {
      const url = portalUrl(options.actionPath);
      bodyParts.push(
        `<p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:#1C4636;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">${escapeHtml(copy.action)}</a></p>`,
      );
    }

    const html = emailShell({
      locale: target.locale,
      heading,
      intro,
      body: bodyParts.join('\n'),
      footer: FOOTER[target.locale],
    });

    const text = plainText({
      heading,
      intro,
      facts: [
        ...(options.facts ?? []),
        // The link belongs in the text part too: a plain-text reader has no button to press.
        ...(options.actionPath
          ? ([[copy.action ?? '', portalUrl(options.actionPath)]] as [string, string][])
          : []),
      ],
      callout: options.callout
        ? ([options.callout.title, options.callout.body] as [string, string])
        : undefined,
      footer: FOOTER[target.locale],
    });

    await sendEmail({
      to: target.contactEmail,
      subject: copy.subject(context),
      html,
      text,
      template: options.template,
    });
  } catch (error) {
    // Fire and forget: a template must never roll back the thing it is reporting.
    logger.error('merchant email failed', {
      template: options.template,
      merchantId: options.merchantId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export async function sendApplicationReceived(merchantId: string): Promise<void> {
  await send({
    merchantId,
    template: 'merchant_application_received',
    actionPath: '/merchant/documents',
  });
}

export async function sendMerchantApproved(
  merchantId: string,
  terms: { commissionPct: number; shippingBorneBy: string },
): Promise<void> {
  const target = await recipient(merchantId);
  const locale = target?.locale ?? DEFAULT_LOCALE;

  const shipping =
    locale === 'sq'
      ? terms.shippingBorneBy === 'merchant'
        ? 'Ti e mbulon transportin — zbritet në shlyerje'
        : terms.shippingBorneBy === 'customer'
          ? 'Klienti e mbulon transportin'
          : 'BioCode e mbulon transportin'
      : terms.shippingBorneBy === 'merchant'
        ? 'You cover shipping — deducted at settlement'
        : terms.shippingBorneBy === 'customer'
          ? 'The customer covers shipping'
          : 'BioCode covers shipping';

  await send({
    merchantId,
    template: 'merchant_approved',
    facts: [
      [locale === 'sq' ? 'Komisioni' : 'Commission', `${terms.commissionPct}%`],
      [locale === 'sq' ? 'Transporti' : 'Shipping', shipping],
      [
        locale === 'sq' ? 'Shlyerja' : 'Settlement',
        locale === 'sq' ? 'Çdo dy javë, me pasqyrë' : 'Fortnightly, with a statement',
      ],
    ],
    actionPath: '/merchant/offers/new',
  });
}

export async function sendMerchantRejected(merchantId: string, reason: string): Promise<void> {
  const target = await recipient(merchantId);
  const locale = target?.locale ?? DEFAULT_LOCALE;

  await send({
    merchantId,
    template: 'merchant_rejected',
    callout: { title: locale === 'sq' ? 'Arsyeja' : 'Reason', body: reason },
  });
}

export async function sendMerchantInfoRequested(merchantId: string, note: string): Promise<void> {
  const target = await recipient(merchantId);
  const locale = target?.locale ?? DEFAULT_LOCALE;

  await send({
    merchantId,
    template: 'merchant_info_requested',
    callout: { title: locale === 'sq' ? 'Çfarë mungon' : 'What is missing', body: note },
    actionPath: '/merchant/documents',
  });
}

// ── Offers and proposals ─────────────────────────────────────────────────────

export async function sendOfferDecided(
  merchantId: string,
  offerId: string,
  approved: boolean,
  note?: string | null,
): Promise<void> {
  const target = await recipient(merchantId);
  const locale = target?.locale ?? DEFAULT_LOCALE;

  await send({
    merchantId,
    template: approved ? 'merchant_offer_approved' : 'merchant_offer_rejected',
    callout:
      !approved && note ? { title: locale === 'sq' ? 'Arsyeja' : 'Reason', body: note } : undefined,
    actionPath: approved ? '/merchant/offers' : `/merchant/offers/${offerId}`,
  });
}

export async function sendProposalDecided(
  merchantId: string,
  productName: string,
  decision: 'approved' | 'rejected' | 'needs_info',
  note?: string | null,
): Promise<void> {
  const target = await recipient(merchantId);
  const locale = target?.locale ?? DEFAULT_LOCALE;

  const decisionLabel =
    locale === 'sq'
      ? decision === 'approved'
        ? 'Miratuar'
        : decision === 'rejected'
          ? 'Refuzuar'
          : 'Kërkohen të dhëna'
      : decision === 'approved'
        ? 'Approved'
        : decision === 'rejected'
          ? 'Rejected'
          : 'More information needed';

  await send({
    merchantId,
    template: 'merchant_proposal_decided',
    context: { productName },
    facts: [
      [locale === 'sq' ? 'Produkti' : 'Product', productName],
      [locale === 'sq' ? 'Vendimi' : 'Decision', decisionLabel],
    ],
    callout: note ? { title: locale === 'sq' ? 'Shënim' : 'Note', body: note } : undefined,
    actionPath: '/merchant/proposals',
  });
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

/**
 * A fulfilment has been routed to this merchant.
 *
 * **No customer detail whatsoever** — not the name, not the town, not the order total. The order number
 * is a reference both sides can say out loud, the unit count tells the merchant whether it is a parcel or
 * a pallet, and everything else is behind the portal link, which is behind a session.
 */
export async function sendFulfilmentAssigned(
  fulfilmentId: string,
  options?: { reminder?: boolean },
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('order_fulfilments')
      .select('id, merchant_id, items_subtotal_cents, merchant_due_cents, orders ( order_number )')
      .eq('id', fulfilmentId)
      .maybeSingle();

    if (error || !data) {
      logger.error('fulfilment email lookup failed', { fulfilmentId, cause: error?.message });
      return;
    }

    const row = data as unknown as {
      merchant_id: string | null;
      items_subtotal_cents: number;
      merchant_due_cents: number;
      orders: { order_number: string } | null;
    };

    if (!row.merchant_id) return;

    const { count } = await admin
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('fulfilment_id', fulfilmentId);

    const target = await recipient(row.merchant_id);
    const locale = target?.locale ?? DEFAULT_LOCALE;
    const orderNumber = row.orders?.order_number ?? '';

    await send({
      merchantId: row.merchant_id,
      template: options?.reminder ? 'merchant_fulfilment_reminder' : 'merchant_fulfilment_assigned',
      context: { orderNumber },
      facts: [
        [locale === 'sq' ? 'Porosia' : 'Order', orderNumber],
        [locale === 'sq' ? 'Artikuj' : 'Lines', String(count ?? 0)],
        [locale === 'sq' ? 'Merr' : 'You get', formatPrice(row.merchant_due_cents, locale)],
      ],
      actionPath: `/merchant/orders/${fulfilmentId}`,
    });
  } catch (error) {
    logger.error('sendFulfilmentAssigned threw', {
      fulfilmentId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Money ────────────────────────────────────────────────────────────────────

export async function sendPayoutReady(payoutId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('merchant_payouts')
      .select('id, merchant_id, period_start, period_end, gross_cents, commission_cents, net_cents')
      .eq('id', payoutId)
      .maybeSingle();

    if (error || !data) {
      logger.error('payout email lookup failed', { payoutId, cause: error?.message });
      return;
    }

    const row = data as {
      merchant_id: string;
      period_start: string;
      period_end: string;
      gross_cents: number;
      commission_cents: number;
      net_cents: number;
    };

    const target = await recipient(row.merchant_id);
    const locale = target?.locale ?? DEFAULT_LOCALE;
    const period = `${row.period_start} – ${row.period_end}`;

    await send({
      merchantId: row.merchant_id,
      template: 'merchant_payout_ready',
      context: { period },
      facts: [
        [locale === 'sq' ? 'Periudha' : 'Period', period],
        [locale === 'sq' ? 'Bruto' : 'Gross', formatPrice(row.gross_cents, locale)],
        [
          locale === 'sq' ? 'Komisioni' : 'Commission',
          `− ${formatPrice(row.commission_cents, locale)}`,
        ],
        [locale === 'sq' ? 'Neto' : 'Net', formatPrice(row.net_cents, locale)],
      ],
      actionPath: `/merchant/payouts/${payoutId}`,
    });
  } catch (error) {
    logger.error('sendPayoutReady threw', {
      payoutId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── The reminder sweep ───────────────────────────────────────────────────────

/**
 * Fulfilments assigned more than the SLA ago and still unanswered.
 *
 * The window comes from `settings.marketplace.auto_accept_hours`, the same number auto-routing would use,
 * so the reminder and the eventual escalation agree about what "late" means.
 *
 * **One reminder per fulfilment, ever.** Checked against `email_log`, not against a column on the
 * fulfilment: the log already records every send and adding a `reminded_at` column would be a second
 * record of the same fact, free to disagree with the first.
 */
export async function findLateFulfilments(now: Date): Promise<string[]> {
  try {
    const admin = createAdminClient();

    const { data: setting } = await admin
      .from('settings')
      .select('value')
      .eq('key', 'marketplace')
      .maybeSingle();

    const config = (setting as { value: Record<string, unknown> } | null)?.value ?? {};
    const hours = typeof config.auto_accept_hours === 'number' ? config.auto_accept_hours : 24;
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin
      .from('order_fulfilments')
      .select('id')
      .eq('fulfiller_kind', 'merchant')
      .eq('status', 'assigned')
      .lt('assigned_at', cutoff);

    if (error) {
      logger.error('findLateFulfilments failed', { cause: error.message });
      return [];
    }

    const candidates = ((data ?? []) as { id: string }[]).map((row) => row.id);
    if (candidates.length === 0) return [];

    /*
     * Which of these has already had its reminder. `email_log` has no fulfilment column, so the portal
     * path in the subject is not usable — the template plus the recipient is too coarse. The link is the
     * `order_id` column, which the send does not set for merchant mail, so this filters on what it can:
     * one reminder per merchant per day, which is the behaviour a merchant would want anyway.
     */
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: sent } = await admin
      .from('email_log')
      .select('to_email')
      .eq('template', 'merchant_fulfilment_reminder')
      .gte('created_at', dayAgo);

    const remindedAddresses = new Set(
      ((sent ?? []) as { to_email: string }[]).map((row) => row.to_email.toLowerCase()),
    );

    if (remindedAddresses.size === 0) return candidates;

    const fresh: string[] = [];
    for (const id of candidates) {
      const { data: row } = await admin
        .from('order_fulfilments')
        .select('merchants ( contact_email )')
        .eq('id', id)
        .maybeSingle();

      const email = (row as unknown as { merchants: { contact_email: string } | null } | null)
        ?.merchants?.contact_email;

      if (!email || !remindedAddresses.has(email.toLowerCase())) fresh.push(id);
    }
    return fresh;
  } catch (error) {
    logger.error('findLateFulfilments threw', {
      cause: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * The operations alert when a merchant moves a fulfilment (owner, 2026-09-01).
 *
 * accepted / packed / shipped / cancelled all used to happen silently: the merchant's action
 * updated the row and the admin learned of it by re-opening /admin/routing. Shipped is the one
 * that costs money to miss — the customer's shipped email fires from the ADMIN's order
 * transition, so an unseen merchant ship delays it — and cancelled is the one that needs
 * re-routing. English on purpose: the admin panel is English-only in v1.
 */
export async function sendFulfilmentOpsAlert(
  fulfilmentId: string,
  status: 'accepted' | 'packed' | 'shipped' | 'cancelled',
): Promise<void> {
  try {
    const { getOpsAlertRecipient } = await import('@/lib/email/recipients');
    const to = await getOpsAlertRecipient();
    if (!to) return;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('order_fulfilments')
      .select('order_id, merchants ( display_name ), orders ( order_number )')
      .eq('id', fulfilmentId)
      .maybeSingle();

    if (error || !data) {
      logger.error('fulfilment ops alert lookup failed', { fulfilmentId, cause: error?.message });
      return;
    }

    const row = data as unknown as {
      order_id: string;
      merchants: { display_name: string } | null;
      orders: { order_number: string } | null;
    };

    const merchant = row.merchants?.display_name ?? 'A merchant';
    const orderNumber = row.orders?.order_number ?? fulfilmentId;
    const link = `${clientEnv.NEXT_PUBLIC_SITE_URL}/admin/routing`;

    const headline: Record<typeof status, string> = {
      accepted: `accepted order ${orderNumber}`,
      packed: `packed order ${orderNumber}`,
      shipped: `shipped order ${orderNumber}`,
      cancelled: `cancelled its part of order ${orderNumber}`,
    };
    const next: Record<typeof status, string> = {
      accepted: 'No action needed — this is the acknowledgement.',
      packed: 'The parcel is ready for the courier.',
      shipped: 'Mark the order shipped so the customer gets their dispatch email.',
      cancelled: 'The fulfilment needs re-routing to another supplier or BioCode stock.',
    };

    await sendEmail({
      to,
      subject: `${merchant} ${headline[status]}`,
      template: `ops_fulfilment_${status}`,
      orderId: row.order_id,
      html: emailShell({
        locale: 'en',
        heading: `${merchant} ${headline[status]}`,
        intro: next[status],
        body: `<p style="margin:24px 0 0"><a href="${link}" style="color:#245741;font-weight:600">Open routing</a></p>`,
        footer: 'Operations alert from biocode.fit — the address is set in /admin/settings.',
      }),
      text: `${merchant} ${headline[status]}. ${next[status]} ${link}`,
    });
  } catch (error) {
    logger.error('sendFulfilmentOpsAlert threw', {
      fulfilmentId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
