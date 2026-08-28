import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env.client';
import { sendEmail } from '@/lib/email/send';
import { emailShell, escapeHtml, factRow, factTable, plainText } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/16 §7 — telling the customer their order is arriving in more than one parcel.
 *
 * ── Why this needs its own email ──
 *
 * The existing lifecycle emails map one order to one status (`templateForStatus`), and `partially_shipped`
 * has no place in that mapping: "your order has shipped" is wrong when half of it has not, and saying
 * nothing means a customer receives one box of a two-box order and assumes something went missing. That
 * assumption becomes a support ticket, and then a chargeback.
 *
 * So the customer is told once, when the **first** parcel of a multi-parcel order ships, what is in it and
 * what is still coming.
 *
 * ── What the customer is not told ──
 *
 * **Not who is shipping which part.** The sale is BioCode↔customer and the merchant is a supplier (terms,
 * clause 1); a customer who ordered from BioCode does not need to learn that a third party is involved in
 * order to understand why there are two boxes, and telling them invites a question — "who do I contact?" —
 * whose answer is BioCode either way.
 *
 * The seller line on the product page is a different matter: that is a disclosure made before buying, to
 * somebody deciding. This is logistics after the fact.
 */

const COPY: Record<
  Locale,
  {
    subject: (orderNumber: string) => string;
    heading: string;
    intro: string;
    inThisParcel: string;
    stillComing: string;
    footer: string;
    track: string;
  }
> = {
  sq: {
    subject: (orderNumber) => `BioCode — porosia ${orderNumber} vjen në dy dërgesa`,
    heading: 'Porosia nis të mbërrijë',
    intro:
      'Një pjesë e porosisë tënde është dërguar dhe pjesa tjetër ndjek pas. Nuk ka humbur asgjë — thjesht nuk udhëtojnë bashkë.',
    inThisParcel: 'Në këtë dërgesë',
    stillComing: 'Ndjekin pas',
    footer:
      'Për çdo pyetje mbi porosinë, shkruaji BioCode-it. Statusin e plotë e shikon në llogarinë tënde.',
    track: 'Gjurmimi',
  },
  en: {
    subject: (orderNumber) => `BioCode — order ${orderNumber} is coming in two deliveries`,
    heading: 'Your order has started to arrive',
    intro:
      'Part of your order has shipped and the rest follows. Nothing is missing — the items simply are not travelling together.',
    inThisParcel: 'In this parcel',
    stillComing: 'Still to come',
    footer:
      'For anything about this order, contact BioCode. The full status is always in your account.',
    track: 'Tracking',
  },
};

/**
 * Sends the notice for one order, if it is warranted.
 *
 * Four conditions, and each one prevents a specific wrong email:
 *
 *   · the order is **`partially_shipped`** — not shipped, where the ordinary email is correct;
 *   · **more than one** fulfilment is live, or there is nothing partial about it;
 *   · at least one has shipped and at least one has not;
 *   · it has **not been sent before**, checked against `email_log`, because the second parcel shipping
 *     must not send "part of your order has shipped" again.
 *
 * Fire and forget, like every other template: it must never roll back the shipment that triggered it.
 */
export async function sendPartialShipmentNotice(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: order, error } = await admin
      .from('orders')
      .select('id, order_number, email, locale, status')
      .eq('id', orderId)
      .maybeSingle();

    if (error || !order) {
      logger.error('partial shipment lookup failed', { orderId, cause: error?.message });
      return;
    }

    const row = order as {
      order_number: string;
      email: string;
      locale: string;
      status: string;
    };

    if (row.status !== 'partially_shipped') return;

    const { data: fulfilments } = await admin
      .from('order_fulfilments')
      .select('id, status, carrier, tracking_code')
      .eq('order_id', orderId)
      .neq('status', 'cancelled');

    const live = (fulfilments ?? []) as {
      id: string;
      status: string;
      carrier: string | null;
      tracking_code: string | null;
    }[];

    if (live.length < 2) return;

    const shipped = live.filter(
      (entry) => entry.status === 'shipped' || entry.status === 'delivered',
    );
    const pending = live.filter(
      (entry) => entry.status !== 'shipped' && entry.status !== 'delivered',
    );

    if (shipped.length === 0 || pending.length === 0) return;

    // Once per order, ever. The second parcel must not re-send "part of your order has shipped".
    const { count } = await admin
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('template', 'order_partially_shipped');

    if ((count ?? 0) > 0) return;

    const locale: Locale = row.locale === 'en' ? 'en' : DEFAULT_LOCALE;
    const copy = COPY[locale];

    const shippedIds = shipped.map((entry) => entry.id);
    const pendingIds = pending.map((entry) => entry.id);

    const { data: items } = await admin
      .from('order_items')
      .select('name_snapshot, quantity, fulfilment_id')
      .eq('order_id', orderId);

    const lines = (items ?? []) as {
      name_snapshot: string;
      quantity: number;
      fulfilment_id: string | null;
    }[];

    const nameList = (ids: string[]): string =>
      lines
        .filter((line) => line.fulfilment_id && ids.includes(line.fulfilment_id))
        .map((line) => `${line.quantity} × ${line.name_snapshot}`)
        .join(', ');

    const inParcel = nameList(shippedIds);
    const toCome = nameList(pendingIds);

    /*
     * The tracking code of the parcel that has shipped, when there is one. Plural parcels already shipped
     * cannot happen on the first notice — this email fires on the transition into `partially_shipped` —
     * but the first entry is taken rather than assumed to be the only one.
     */
    const tracked = shipped.find((entry) => entry.tracking_code);

    const facts: [string, string][] = [
      [copy.inThisParcel, inParcel],
      [copy.stillComing, toCome],
      ...(tracked?.tracking_code
        ? ([[copy.track, `${tracked.carrier ?? ''} ${tracked.tracking_code}`.trim()]] as [
            string,
            string,
          ][])
        : []),
    ];

    const accountUrl = `${clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}${
      locale === 'en' ? '/en' : ''
    }/account/orders`;

    const html = emailShell({
      locale,
      heading: copy.heading,
      intro: copy.intro,
      body:
        factTable(
          facts.map(([label, value]) => factRow(escapeHtml(label), escapeHtml(value))).join(''),
        ) +
        `<p style="margin:24px 0 0"><a href="${accountUrl}" style="display:inline-block;background:#1C4636;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500">${escapeHtml(
          locale === 'sq' ? 'Shiko porosinë' : 'View your order',
        )}</a></p>`,
      footer: copy.footer,
    });

    const text = plainText({
      heading: copy.heading,
      intro: copy.intro,
      facts,
      footer: copy.footer,
    });

    await sendEmail({
      to: row.email,
      subject: copy.subject(row.order_number),
      html,
      text,
      template: 'order_partially_shipped',
      orderId,
    });
  } catch (cause) {
    logger.error('sendPartialShipmentNotice threw', {
      orderId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Orders that have become `partially_shipped` and not yet been told.
 *
 * A sweep rather than a call from the shipping action, because the transition is made by a **database
 * trigger** (`sync_order_status_from_fulfilments`) fired by whichever party shipped — a merchant in the
 * portal, BioCode's warehouse, or a courier webhook. There is no single code path to hang the send on, and
 * adding one to each would mean the third one forgets.
 *
 * `sendPartialShipmentNotice` is itself idempotent, so a sweep that overlaps a previous run is harmless.
 */
export async function findPartiallyShippedOrders(): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('orders')
      .select('id')
      .eq('status', 'partially_shipped')
      // A day's window: an order partial for longer than that has a bigger problem than an email.
      .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error) {
      logger.error('findPartiallyShippedOrders failed', { cause: error.message });
      return [];
    }
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  } catch (cause) {
    logger.error('findPartiallyShippedOrders threw', {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return [];
  }
}
