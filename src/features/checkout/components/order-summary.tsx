import { getLocale, getTranslations } from 'next-intl/server';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import type { OrderSummaryData } from '@/features/orders/types';

/** Read-only order view, shared by the success page and order lookup. */
export async function OrderSummary({ order }: { order: OrderSummaryData }) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  const address = order.shippingAddress;
  const addressLines = [
    address.recipient_name,
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(' '),
    address.phone,
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="order-items">
        <h2 id="order-items" className="font-display text-lg font-semibold text-carbon-900">
          {t('order.items')}
        </h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {order.items.map((item) => (
            <li key={item.sku} className="flex justify-between gap-4 py-3">
              <span className="min-w-0 text-ink-900">
                {item.name}
                <span className="text-ink-500"> × {item.quantity}</span>
                {/*
                  ink-500, not ink-400. `tests/unit/contrast.test.ts` documents ink-400 as
                  below AA and decorative-only, and this is a SKU a customer reads out on the
                  phone to support — 2.96:1 at 12px. It survived M4 because axe never reached
                  this component: it runs on the cart and checkout, but the success page needs
                  an access cookie, so nothing exercised the summary until the account order
                  page gave it a reachable home.
                */}
                <span className="block text-xs text-ink-500">{item.sku}</span>
              </span>
              <span className="font-medium whitespace-nowrap" data-numeric>
                {formatPrice(item.totalCents, locale)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">{t('cart.subtotal')}</dt>
            <dd data-numeric>{formatPrice(order.subtotalCents, locale)}</dd>
          </div>
          {order.discountCents > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-600">
                {t('order.discount')}
                {order.couponCode ? ` (${order.couponCode})` : ''}
              </dt>
              <dd className="text-success" data-numeric>
                −{formatPrice(order.discountCents, locale)}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-600">{t('cart.shipping')}</dt>
            <dd data-numeric>
              {order.shippingCents === 0
                ? t('checkout.free')
                : formatPrice(order.shippingCents, locale)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{t('checkout.total')}</dt>
            <dd data-numeric>{formatPrice(order.totalCents, locale)}</dd>
          </div>
        </dl>
        {/* docs/07 §5 — VAT shown informationally, because pricing is VAT-inclusive. */}
        <p className="mt-1 text-xs text-ink-500">
          {t('order.vatIncluded', { amount: formatPrice(order.taxCents, locale) })}
        </p>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="order-address">
          <h2 id="order-address" className="font-display text-lg font-semibold text-carbon-900">
            {t('order.deliveryAddress')}
          </h2>
          <address className="mt-3 text-sm leading-relaxed text-ink-600 not-italic">
            {addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        </section>

        <section aria-labelledby="order-delivery">
          <h2 id="order-delivery" className="font-display text-lg font-semibold text-carbon-900">
            {t('order.delivery')}
          </h2>
          <p className="mt-3 text-sm text-ink-600">
            {pickLocale(order.shippingMethodName, locale)}
          </p>
          {order.minDays != null && order.maxDays != null && (
            <p className="mt-1 text-sm text-ink-500">
              {t('checkout.eta', { min: order.minDays, max: order.maxDays })}
            </p>
          )}
          <p className="mt-3 text-sm text-ink-500">
            {t('order.statusLabel')}:{' '}
            <span className="text-ink-900">{t(`order.status.${order.status}`)}</span>
          </p>
        </section>
      </div>
    </div>
  );
}
