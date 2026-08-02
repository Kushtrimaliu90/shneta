import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { Alert } from '@/components/ui/alert';
import { OrderSummary } from '@/features/checkout/components/order-summary';
import { getMyOrderByNumber } from '@/features/orders/queries';
import { customerCanCancel } from '@/features/orders/types';
import { OrderStatusPill } from '@/features/orders/components/order-status-pill';
import { CustomerCancelForm } from '@/features/orders/components/customer-cancel-form';
import { CustomerTimeline } from '@/features/orders/components/customer-timeline';

type Props = { params: Promise<{ locale: string; orderNumber: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orderNumber } = await params;
  return { title: orderNumber, robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — a customer reading their own order.
 *
 * `notFound()` covers both "no such order" and "not yours", because `getMyOrderByNumber` reads
 * under the customer's own RLS and cannot see anyone else's row. One branch, and probing order
 * numbers reveals nothing.
 *
 * The summary is the **same component** the checkout success page and guest lookup render. A
 * customer should see the same figures in the same layout wherever they look at an order;
 * three views of one order that lay it out three ways is how a support call starts with "but
 * the other page said…".
 */
export default async function AccountOrderPage({ params }: Props) {
  const { locale: rawLocale, orderNumber } = await params;
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const [order, t] = await Promise.all([getMyOrderByNumber(orderNumber), getTranslations()]);
  if (!order) notFound();

  const cancellable = customerCanCancel(order.status);

  return (
    <div>
      <Link
        href="/account/orders"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-ink-600 hover:text-carbon-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('order.myOrders.title')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t('order.orderNumber')}</p>
          {/* h2: the account layout owns the h1 (docs/04 §10 — one h1 per page). */}
          <h2 className="mt-1 font-display text-2xl font-semibold text-carbon-900" data-numeric>
            {order.orderNumber}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {t('order.placedOn', {
              date: new Date(order.placedAt).toLocaleDateString(rawLocale),
            })}
          </p>
        </div>
        <OrderStatusPill status={order.status} />
      </div>

      {/* docs/07 §7.4 — cancellable while pending; a clear route to a human afterwards. */}
      {cancellable ? (
        <div className="mt-6">
          <CustomerCancelForm orderNumber={order.orderNumber} />
        </div>
      ) : (
        order.status !== 'delivered' &&
        order.status !== 'cancelled' &&
        order.status !== 'refunded' && (
          <Alert tone="info" className="mt-6" title={t('order.myOrders.cancelTooLateTitle')}>
            {t('order.myOrders.cancelTooLateBody')}{' '}
            <Link href="/contact" className="underline underline-offset-4">
              {t('order.myOrders.contactSupport')}
            </Link>
          </Alert>
        )
      )}

      <div className="mt-8">
        <OrderSummary order={order} />
      </div>

      <div className="mt-10">
        <CustomerTimeline events={order.events} />
      </div>
    </div>
  );
}
