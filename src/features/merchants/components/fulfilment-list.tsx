'use client';

import { useTranslations } from 'next-intl';
import { Banknote, Clock } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { FulfilmentStatus, FulfilmentSummary } from '@/features/merchants/fulfilment-queries';

/**
 * docs/16 §7 — the merchant's order list.
 *
 * A card per fulfilment rather than a table, and the reason is the content: the row a merchant acts on
 * carries a status, a deadline, a money figure and a COD flag, and four of those in a table cell is
 * how a merchant misses the one that matters at 360 px.
 *
 * **No customer name and no address here.** The list is a screen somebody scrolls past; the address
 * belongs on the one parcel they are about to pack, which is the detail page — and the database
 * withholds it from this shape entirely rather than trusting the component not to render it (§3).
 */
export function FulfilmentList({
  fulfilments,
  locale,
}: {
  fulfilments: FulfilmentSummary[];
  locale: Locale;
}) {
  const t = useTranslations('merchant.fulfilments');

  return (
    <ul className="flex flex-col gap-3">
      {fulfilments.map((fulfilment) => (
        <li key={fulfilment.id}>
          <Link
            href={`/merchant/orders/${fulfilment.id}`}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500/50 hover:bg-forest-50/40"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-ui font-semibold text-forest-900" data-numeric>
                  {fulfilment.orderNumber}
                </p>
                <p className="text-[13px] text-ink-500">
                  {t('placed', { date: fulfilment.placedAt.slice(0, 10) })} ·{' '}
                  {t('units', { count: fulfilment.unitCount })}
                </p>
              </div>
              <StatusChip status={fulfilment.status} label={t(`status.${fulfilment.status}`)} />
            </div>

            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-ink-500">{t('due')}</dt>
                <dd className="font-medium text-ink-900" data-numeric>
                  {formatPrice(fulfilment.merchantDueCents, locale)}
                </dd>
              </div>
              {fulfilment.codAmountCents > 0 && (
                <div className="flex items-center gap-1.5">
                  <Banknote className="size-4 text-warning" aria-hidden="true" />
                  <dt className="text-ink-500">{t('collectCod')}</dt>
                  <dd className="font-medium text-ink-900" data-numeric>
                    {formatPrice(fulfilment.codAmountCents, locale)}
                  </dd>
                </div>
              )}
              {fulfilment.trackingCode && (
                <div className="flex gap-1.5">
                  <dt className="text-ink-500">{t('tracking')}</dt>
                  <dd className="font-medium text-ink-900">{fulfilment.trackingCode}</dd>
                </div>
              )}
            </dl>

            {/* The one status with a clock on it: an unanswered assignment is the SLA (§6). */}
            {fulfilment.status === 'assigned' && (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-warning">
                <Clock className="size-3.5" aria-hidden="true" />
                {t('needsAnswer')}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function StatusChip({ status, label }: { status: FulfilmentStatus; label: string }) {
  const tone =
    status === 'shipped' || status === 'delivered'
      ? 'bg-success text-white'
      : status === 'assigned'
        ? 'bg-warning text-white'
        : status === 'cancelled' || status === 'returned'
          ? 'bg-error text-white'
          : status === 'unassigned'
            ? 'bg-ink-400 text-white'
            : 'bg-forest-800 text-white';

  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold whitespace-nowrap',
        tone,
      )}
    >
      {label}
    </span>
  );
}
