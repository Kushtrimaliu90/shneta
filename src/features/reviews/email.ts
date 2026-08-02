import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientEnv } from '@/lib/env.client';
import { sendEmail } from '@/lib/email/send';
import { emailShell, escapeHtml, plainText } from '@/lib/email/layout';
import { logger } from '@/lib/logger';
import { pickLocaleFrom } from '@/lib/i18n';
import { DEFAULT_LOCALE, type Locale } from '@/lib/constants';

/**
 * docs/12 M7 — the review request, seven days after delivery.
 *
 * Service client, for the same reason as the order lifecycle emails (docs/02 §6): this runs
 * from a cron job with no session, and it has to read an order and its items to know what to
 * ask about.
 *
 * **Signed-in customers only.** A guest order has no account, so the link would land them on a
 * sign-in page for an account they do not have — an email that cannot be acted on is worse than
 * no email. Guests are invited to create an account by the order confirmation instead.
 */

const COPY = {
  sq: {
    subject: 'Si ishte {product}?',
    heading: 'Si po të shkon?',
    intro:
      'Porosia jote u dorëzua para një jave. Nëse ke një minutë, një vlerësim i shkurtër ndihmon klientët e tjerë të zgjedhin.',
    cta: 'Vlerëso produktin',
    footer: 'E merr këtë email sepse ke bërë një porosi te BIOCODE.',
  },
  en: {
    subject: 'How was your {product}?',
    heading: 'How is it going?',
    intro:
      'Your order arrived a week ago. If you have a minute, a short review helps other customers choose.',
    cta: 'Review the product',
    footer: 'You are receiving this because you ordered from BIOCODE.',
  },
} as const;

interface ReviewRequestTarget {
  orderId: string;
  email: string;
  locale: Locale;
  productSlug: string;
  productName: string;
}

/**
 * Sends one review request. Never throws — a failed email must not fail the cron run, and the
 * attempt is recorded in `email_log` either way.
 */
export async function sendReviewRequest(target: ReviewRequestTarget): Promise<void> {
  try {
    const copy = COPY[target.locale] ?? COPY[DEFAULT_LOCALE];
    const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
    const path = target.locale === DEFAULT_LOCALE ? '' : `/${target.locale}`;
    const url = `${origin}${path}/product/${target.productSlug}#reviews`;

    const subject = copy.subject.replace('{product}', target.productName);

    const html = emailShell({
      locale: target.locale,
      heading: copy.heading,
      intro: copy.intro,
      body: `<p style="margin:0 0 16px"><strong>${escapeHtml(target.productName)}</strong></p>
             <p style="margin:0"><a href="${url}">${escapeHtml(copy.cta)}</a></p>`,
      footer: copy.footer,
    });

    await sendEmail({
      to: target.email,
      subject,
      html,
      text: plainText({
        heading: copy.heading,
        intro: copy.intro,
        callout: [target.productName, url],
        footer: copy.footer,
      }),
      template: 'review_request',
      orderId: target.orderId,
    });
  } catch (error) {
    logger.error('Review request email failed', {
      orderId: target.orderId,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Finds the orders delivered seven days ago that should be asked for a review.
 *
 * Three conditions, and each one exists to avoid a specific annoyance:
 *
 *   · **exactly the seventh day**, not "older than seven days" — a `>=` predicate would email
 *     every delivered order in the shop's history on the first night this cron runs, and again
 *     the night after. The window is one day wide and moves;
 *   · **has a `user_id`** — see the note above about guests;
 *   · **no review yet** for that product by that customer — asking someone to review something
 *     they already reviewed is the most obvious kind of wrong.
 *
 * Only the first product of each order is asked about. A five-item order does not warrant five
 * emails, and one specific question gets answered more often than a list of five.
 */
export async function findReviewRequestTargets(now: Date): Promise<ReviewRequestTarget[]> {
  const supabase = createAdminClient();

  const dayStart = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const dayEnd = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, email, locale, user_id, delivered_at,
       order_items ( product_id, name, products ( slug, name ) )`,
    )
    .eq('status', 'delivered')
    .not('user_id', 'is', null)
    .gte('delivered_at', dayStart)
    .lt('delivered_at', dayEnd)
    .limit(200);

  if (error) {
    logger.error('findReviewRequestTargets failed', { cause: error.message });
    return [];
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    email: string;
    locale: string;
    user_id: string;
    order_items: {
      product_id: string;
      name: string;
      products: { slug: string; name: unknown } | null;
    }[];
  }[];

  const targets: ReviewRequestTarget[] = [];

  for (const order of rows) {
    const item = order.order_items[0];
    if (!item?.products) continue;

    const { data: existing } = await supabase
      .from('reviews')
      .select('id')
      .eq('user_id', order.user_id)
      .eq('product_id', item.product_id)
      .maybeSingle();

    if (existing) continue;

    const locale: Locale = order.locale === 'en' ? 'en' : DEFAULT_LOCALE;
    targets.push({
      orderId: order.id,
      email: order.email,
      locale,
      productSlug: item.products.slug,
      // The live catalogue name, falling back to the snapshot on the order item — a product
      // renamed since the order still reads correctly, and a deleted one still has a name.
      productName: pickLocaleFrom(item.products.name, locale) || item.name,
    });
  }

  return targets;
}
