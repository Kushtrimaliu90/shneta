import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Package } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { listMyOrders } from '@/features/orders/queries';
import { OrderStatusPill } from '@/features/orders/components/order-status-pill';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — per-visitor, never cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'order.myOrders',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — the customer's own orders.
 *
 * No user filter in the query. `p_read on orders` already restricts a customer to
 * `user_id = auth.uid()`, so the list is scoped by RLS rather than by a `.eq()` somebody has to
 * remember. Guest orders are absent by construction — they have no `user_id` — and are reached
 * through order lookup instead (docs/05 §13).
 */
export default async function AccountOrdersPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [orders, t] = await Promise.all([listMyOrders(), getTranslations()]);

  if (orders.length === 0) {
    return (
      <div>
        <h2 className="font-display text-2xl font-semibold text-carbon-900">
          {t('order.myOrders.title')}
        </h2>
        <EmptyState
          icon={Package}
          title={t('order.myOrders.empty')}
          body={t('order.myOrders.emptyBody')}
          className="mt-6"
          action={
            <Link href="/shop" className={buttonVariants()}>
              {t('common.browseShop')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      {/* h2, not h1: the account layout owns the page's single h1 (the greeting). */}
      <h2 className="font-display text-2xl font-semibold text-carbon-900">
        {t('order.myOrders.title')}
      </h2>

      {/*
        Cards rather than a table. A customer reads one order at a time and needs it to work at
        360 px; the admin queue needs to be scanned in columns, which is why that one is a
        table. Same data, different job.
      */}
      <ul className="mt-6 flex flex-col gap-3">
        {orders.map((order) => (
          <li key={order.id}>
            <Link
              href={`/account/orders/${order.orderNumber}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-carbon-50/40"
            >
              <div className="min-w-0">
                <p className="font-medium text-carbon-900" data-numeric>
                  {order.orderNumber}
                </p>
                <p className="mt-0.5 text-sm text-ink-600">
                  {t('order.myOrders.placedOn', {
                    date: new Date(order.placedAt).toLocaleDateString(locale),
                  })}
                  {' · '}
                  {t('order.myOrders.itemCount', { count: order.itemCount })}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <OrderStatusPill status={order.status} />
                <span className="font-semibold text-carbon-900" data-numeric>
                  {formatPrice(order.totalCents, locale)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
