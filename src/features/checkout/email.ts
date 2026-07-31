import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env.client';
import { formatPrice } from '@/lib/money';
import { sendEmail } from '@/lib/email/send';
import { logger } from '@/lib/logger';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/08 §6 — the order-confirmation email.
 *
 * Rendered as a plain HTML string rather than with react-email. The shared layout in docs/08
 * §6 is a logo, a rule, content and a footer; a JSX renderer earns its place once there are a
 * dozen templates sharing components, and adding it for the first one would be scaffolding
 * ahead of need. Every later template can move to react-email together.
 *
 * Read with the service client because this runs for guest orders too, where there is no
 * session to read the order under — sanctioned by docs/02 §6 (email dispatch).
 *
 * The email renders in `order.locale`, not the sender's — the customer chose that language.
 */

interface OrderForEmail {
  id: string;
  order_number: string;
  email: string;
  locale: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  coupon_code: string | null;
  shipping_address: Record<string, unknown>;
  shipping_method: { min_days?: number; max_days?: number } | null;
  order_items: { name_snapshot: string; sku: string; quantity: number; total_cents: number }[];
}

const COPY = {
  sq: {
    subject: (n: string) => `Porosia ${n} — faleminderit!`,
    heading: 'Faleminderit për porosinë',
    intro: 'E pranuam porosinë tuaj. Do ta përgatisim dhe ju kontaktojmë para dërgesës.',
    orderNumber: 'Numri i porosisë',
    items: 'Produktet',
    subtotal: 'Nëntotali',
    discount: 'Zbritja',
    shipping: 'Dërgesa',
    total: 'Totali',
    vatLine: (amount: string) => `Përfshin TVSH-në: ${amount}`,
    codHeading: 'Pagesa në dorëzim',
    codBody: (amount: string) => `Përgatit ${amount} në para të gatshme për korrierin.`,
    delivery: (min: number, max: number) => `Dërgesa pritet brenda ${min}–${max} ditësh.`,
    address: 'Adresa e dërgesës',
    track: 'Gjurmo porosinë me numrin e porosisë dhe email-in tuaj:',
    free: 'Falas',
  },
  en: {
    subject: (n: string) => `Order ${n} — thank you!`,
    heading: 'Thanks for your order',
    intro: "We've received your order. We'll prepare it and contact you before delivery.",
    orderNumber: 'Order number',
    items: 'Items',
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Delivery',
    total: 'Total',
    vatLine: (amount: string) => `Includes VAT: ${amount}`,
    codHeading: 'Cash on delivery',
    codBody: (amount: string) => `Please have ${amount} in cash ready for the courier.`,
    delivery: (min: number, max: number) => `Delivery is expected within ${min}–${max} days.`,
    address: 'Delivery address',
    track: 'Track your order with the order number and your email:',
    free: 'Free',
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendOrderConfirmation(orderId: string): Promise<void> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('orders')
    .select(
      `id, order_number, email, locale, subtotal_cents, discount_cents, shipping_cents,
       tax_cents, total_cents, coupon_code, shipping_address, shipping_method,
       order_items ( name_snapshot, sku, quantity, total_cents )`,
    )
    .eq('id', orderId)
    .single();

  if (error || !data) {
    logger.error('Cannot send confirmation — order not readable', {
      orderId,
      cause: error?.message,
    });
    return;
  }

  const order = data as unknown as OrderForEmail;
  const locale: Locale = order.locale === 'en' ? 'en' : DEFAULT_LOCALE;
  const c = COPY[locale];
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  const money = (cents: number) => formatPrice(cents, locale);
  const address = order.shipping_address as Record<string, string | null>;

  const addressLines = [
    address.recipient_name,
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(' '),
    address.phone,
  ]
    .filter((line): line is string => Boolean(line))
    .map(escapeHtml);

  const itemRows = order.order_items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #E6E8E4">
            ${escapeHtml(item.name_snapshot)}
            <span style="color:#6B746F"> × ${item.quantity}</span>
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #E6E8E4;text-align:right;white-space:nowrap">
            ${money(item.total_cents)}
          </td>
        </tr>`,
    )
    .join('');

  const totalRow = (label: string, value: string, bold = false) =>
    `<tr>
      <td style="padding:4px 0;${bold ? 'font-weight:600' : 'color:#565E59'}">${label}</td>
      <td style="padding:4px 0;text-align:right;white-space:nowrap;${bold ? 'font-weight:600' : ''}">${value}</td>
    </tr>`;

  const html = `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;background:#FAF9F5;font-family:ui-sans-serif,system-ui,sans-serif;color:#1B1E1C">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <p style="margin:0;font-size:20px;font-weight:600;color:#123227">SHNETA</p>
      <hr style="border:none;border-top:3px solid #1C4636;margin:12px 0 28px" />

      <h1 style="margin:0;font-size:22px;color:#123227">${c.heading}</h1>
      <p style="margin:12px 0 0;color:#565E59;line-height:1.6">${c.intro}</p>

      <p style="margin:24px 0 0;color:#565E59">
        ${c.orderNumber}: <strong style="color:#1B1E1C">${escapeHtml(order.order_number)}</strong>
      </p>

      <h2 style="margin:28px 0 8px;font-size:15px;color:#123227">${c.items}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows}</table>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
        ${totalRow(c.subtotal, money(order.subtotal_cents))}
        ${order.discount_cents > 0 ? totalRow(`${c.discount}${order.coupon_code ? ` (${escapeHtml(order.coupon_code)})` : ''}`, `−${money(order.discount_cents)}`) : ''}
        ${totalRow(c.shipping, order.shipping_cents === 0 ? c.free : money(order.shipping_cents))}
        ${totalRow(c.total, money(order.total_cents), true)}
      </table>
      <p style="margin:6px 0 0;font-size:12px;color:#6B746F">${c.vatLine(money(order.tax_cents))}</p>

      <div style="margin-top:28px;padding:16px;background:#F0F7F3;border-radius:12px">
        <p style="margin:0;font-weight:600;color:#123227">${c.codHeading}</p>
        <p style="margin:6px 0 0;color:#565E59">${c.codBody(money(order.total_cents))}</p>
      </div>

      ${
        order.shipping_method?.min_days != null && order.shipping_method.max_days != null
          ? `<p style="margin:20px 0 0;color:#565E59">${c.delivery(order.shipping_method.min_days, order.shipping_method.max_days)}</p>`
          : ''
      }

      <h2 style="margin:28px 0 8px;font-size:15px;color:#123227">${c.address}</h2>
      <p style="margin:0;color:#565E59;line-height:1.6">${addressLines.join('<br />')}</p>

      <p style="margin:28px 0 0;color:#565E59">
        ${c.track}<br />
        <a href="${origin}/order-lookup" style="color:#245741">${origin}/order-lookup</a>
      </p>

      <hr style="border:none;border-top:1px solid #E6E8E4;margin:32px 0 16px" />
      <p style="margin:0;font-size:12px;color:#8B948E;line-height:1.6">
        SHNETA · Prishtinë, Kosovë
      </p>
    </div>
  </body>
</html>`;

  const text = [
    c.heading,
    '',
    `${c.orderNumber}: ${order.order_number}`,
    '',
    ...order.order_items.map(
      (item) => `${item.name_snapshot} × ${item.quantity} — ${money(item.total_cents)}`,
    ),
    '',
    `${c.subtotal}: ${money(order.subtotal_cents)}`,
    `${c.shipping}: ${order.shipping_cents === 0 ? c.free : money(order.shipping_cents)}`,
    `${c.total}: ${money(order.total_cents)}`,
    c.vatLine(money(order.tax_cents)),
    '',
    `${c.codHeading}: ${c.codBody(money(order.total_cents))}`,
    '',
    `${c.track} ${origin}/order-lookup`,
  ].join('\n');

  await sendEmail({
    to: order.email,
    subject: c.subject(order.order_number),
    html,
    text,
    template: 'order-confirmation',
    orderId: order.id,
  });
}
