import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { buttonVariants } from '@/components/ui/button';
import { OrderSummary } from '@/features/checkout/components/order-summary';
import { getOrderByAccessCookie } from '@/features/checkout/order-access';

type Props = { params: Promise<{ locale: string; orderNumber: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'order',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §13 — the read-only order status view.
 *
 * Reached only after a successful lookup, which set the access cookie. The gate is the same
 * one the success page uses, so there is a single authorisation path for reading an order
 * without a session (docs/13 §B1). Landing here without the cookie — a shared link, a stale
 * bookmark — sends you back to the form rather than showing someone else's order.
 */
export default async function OrderLookupResultPage({ params }: Props) {
  const { locale: rawLocale, orderNumber } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const order = await getOrderByAccessCookie(orderNumber);
  // Localized, or an English customer is bounced into the Albanian lookup form.
  if (!order) redirect(localizePath('/order-lookup', locale));

  const t = await getTranslations();

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">{t('order.orderNumber')}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-forest-900" data-numeric>
          {order.orderNumber}
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          {t('order.placedOn', { date: new Date(order.placedAt).toLocaleDateString(rawLocale) })}
        </p>

        <div className="mt-10">
          <OrderSummary order={order} />
        </div>

        <div className="mt-10 border-t border-line pt-6">
          <Link href="/order-lookup" className={buttonVariants({ variant: 'secondary' })}>
            {t('order.lookup.searchAnother')}
          </Link>
        </div>
      </div>
    </div>
  );
}
