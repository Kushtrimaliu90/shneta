import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Banknote, MapPin } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { getMyMerchant } from '@/features/merchants/queries';
import { getMyFulfilment } from '@/features/merchants/fulfilment-queries';
import { FulfilmentActionsPanel } from '@/features/merchants/components/fulfilment-actions-panel';

export const metadata: Metadata = { title: 'Porosia' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * docs/16 §3, §7 — one parcel, and everything needed to pack it.
 *
 * `getMyFulfilment` goes through `merchant_fulfilment_view`, which returns **null** for a fulfilment
 * belonging to another merchant — so this page is a 404 not because it checked, but because the row
 * does not exist as far as this session is concerned.
 *
 * The address appears here and only here, and only once assigned. Before that the merchant is one of
 * several candidates on the routing screen and only one of them will ever ship it; the function
 * withholds it, so this page cannot leak it by rendering the wrong field.
 *
 * What is still absent, on purpose: the customer's email, the order total, the coupon, the loyalty
 * points, and any other fulfilment of the same order. A merchant is a supplier, and the sale is
 * BioCode↔customer (marketplace terms, clause 1).
 */
export default async function MerchantFulfilmentPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);

  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const fulfilment = await getMyFulfilment(id);
  if (!fulfilment) notFound();

  const t = await getTranslations('merchant.fulfilments');

  const address = fulfilment.shipTo?.address ?? {};
  const addressLines = ['line1', 'line2', 'city', 'postal_code']
    .map((key) => (typeof address[key] === 'string' ? (address[key] as string) : ''))
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('breadcrumb')}>
        <Link href="/merchant/orders" className="text-sm text-forest-800 underline">
          ← {t('title')}
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-900" data-numeric>
            {fulfilment.orderNumber}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {t('placed', { date: fulfilment.placedAt.slice(0, 10) })} ·{' '}
            {t(`status.${fulfilment.status}`)}
          </p>
        </div>
      </header>

      <FulfilmentActionsPanel fulfilment={fulfilment} />

      <section aria-labelledby="lines" className="flex flex-col gap-3">
        <h3 id="lines" className="font-display text-lg font-semibold text-forest-900">
          {t('whatToSend')}
        </h3>

        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <caption className="sr-only">{t('linesCaption')}</caption>
            <thead>
              <tr className="border-b border-line bg-cream text-left">
                <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                  {t('product')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
                  {t('quantity')}
                </th>
              </tr>
            </thead>
            <tbody>
              {fulfilment.items.map((item) => (
                <tr key={`${item.sku}-${item.name}`} className="border-b border-line last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium text-ink-900">{item.name}</p>
                    <p className="text-[13px] text-ink-500">{item.sku}</p>
                  </td>
                  <td className="px-3 py-3 font-ui font-semibold" data-numeric>
                    ×{item.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {fulfilment.shipTo ? (
        <section aria-labelledby="ship-to" className="flex flex-col gap-3">
          <h3 id="ship-to" className="font-display text-lg font-semibold text-forest-900">
            {t('shipTo')}
          </h3>
          <address className="flex items-start gap-2 rounded-lg border border-line bg-surface p-4 text-sm not-italic text-ink-900">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden="true" />
            <span>
              {fulfilment.shipTo.name && <span className="block font-medium">{fulfilment.shipTo.name}</span>}
              {addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {fulfilment.shipTo.phone && <span className="block">{fulfilment.shipTo.phone}</span>}
            </span>
          </address>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-ink-600">
          {t('addressAfterAssignment')}
        </p>
      )}

      <section aria-labelledby="money" className="flex flex-col gap-3">
        <h3 id="money" className="font-display text-lg font-semibold text-forest-900">
          {t('money')}
        </h3>

        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              {t('linesSubtotal')}
            </dt>
            <dd className="mt-0.5 text-ink-900" data-numeric>
              {formatPrice(fulfilment.itemsSubtotalCents, locale)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
              {t('due')}
            </dt>
            <dd className="mt-0.5 font-medium text-forest-900" data-numeric>
              {formatPrice(fulfilment.merchantDueCents, locale)}
            </dd>
          </div>
        </dl>

        {fulfilment.codAmountCents > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
            <Banknote className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {t('codNotice', { amount: formatPrice(fulfilment.codAmountCents, locale) })}
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
