'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Pause, Play, Trophy } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { ScrollRegion } from '@/components/ui/scroll-region';
import {
  setOfferStatus,
  updateOfferStock,
  type OfferState,
} from '@/features/merchants/offer-actions';
import type { OfferRow } from '@/features/merchants/queries';
import { offerErrorLeaf } from '@/features/merchants/error-keys';

/**
 * docs/16 §5 — the offers list.
 *
 * A real `<table>`, because this is tabular data and a grid of divs would need six ARIA attributes to
 * say what `<th scope>` says for free. It scrolls horizontally inside its own container rather than
 * pushing the page sideways at 360 px.
 *
 * Two things are editable inline, and only two: **stock**, which is the edit a merchant makes daily,
 * and **pause/resume**, which is what they reach for when they run out at the shop. Everything else
 * goes through the detail page — a table where six fields are editable is a table where somebody
 * changes a price by mistake.
 */
export function OffersTable({
  offers,
  winningIds,
  locale,
}: {
  offers: OfferRow[];
  /** Serialised as an array because a `Set` does not survive the server→client boundary. */
  winningIds: string[];
  locale: Locale;
}) {
  const t = useTranslations('merchant.offers');
  const winning = new Set(winningIds);

  return (
    <ScrollRegion label={t('tableCaption')} className="rounded-lg border border-line">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead>
          <tr className="border-b border-line bg-cream text-left">
            <Th>{t('columns.product')}</Th>
            <Th>{t('columns.retail')}</Th>
            <Th>{t('columns.asking')}</Th>
            <Th>{t('columns.due')}</Th>
            <Th>{t('columns.stock')}</Th>
            <Th>{t('columns.status')}</Th>
            <Th>
              <span className="sr-only">{t('columns.actions')}</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.id} className="border-b border-line last:border-0 align-top">
              <td className="px-3 py-3">
                <Link
                  href={`/merchant/offers/${offer.id}`}
                  className="font-medium text-forest-800 underline-offset-2 hover:underline"
                >
                  {pickLocale(offer.productName, locale)}
                </Link>
                <p className="text-[13px] text-ink-500">
                  {pickLocale(offer.variantName, locale) || offer.sku} · {offer.sku}
                </p>
                {!offer.productPublished && (
                  <p className="text-[13px] text-warning">{t('unpublished')}</p>
                )}
              </td>

              <td className="px-3 py-3 whitespace-nowrap" data-numeric>
                {formatPrice(offer.retailPriceCents, locale)}
              </td>
              <td className="px-3 py-3 whitespace-nowrap" data-numeric>
                {formatPrice(offer.askingPriceCents, locale)}
              </td>
              <td className="px-3 py-3 whitespace-nowrap" data-numeric>
                {formatPrice(offer.merchantDueCents, locale)}
              </td>

              <td className="px-3 py-3">
                <StockCell offer={offer} />
              </td>

              <td className="px-3 py-3">
                <StatusChip status={offer.status} label={t(`status.${offer.status}`)} />
                {/*
                  `forest-800`, not `lime-500`.

                  Lime is the brand accent — `#a3e635` on the cream surface is about 1.8:1, nowhere near
                  the 4.5:1 AA needs for small text, and axe flagged it as a serious `color-contrast`
                  violation on this exact line. It belongs on the focus ring and on dark backgrounds,
                  which is where the palette puts it (docs/13 §C).
                */}
                {winning.has(offer.id) && (
                  <p className="mt-1 flex items-center gap-1 text-[13px] font-medium text-forest-800">
                    <Trophy className="size-3.5" aria-hidden="true" />
                    {t('inBuyBox')}
                  </p>
                )}
                {offer.status === 'approved' && offer.stockOnHand <= 0 && (
                  <p className="mt-1 text-[13px] text-warning">{t('hiddenNoStock')}</p>
                )}
                {offer.status === 'rejected' && offer.rejectionNote && (
                  <p className="mt-1 text-[13px] text-ink-600">{offer.rejectionNote}</p>
                )}
              </td>

              <td className="px-3 py-3">
                <PauseCell offer={offer} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

/**
 * Stock, editable in place.
 *
 * A number input and a save button rather than a debounced auto-save: stock is the field with real
 * consequences — zero takes the offer off the storefront — and an accidental keystroke that saves
 * itself is not a trade worth making for one click.
 */
function StockCell({ offer }: { offer: OfferRow }) {
  const t = useTranslations('merchant.offers');
  const [state, action] = useActionState<OfferState, FormData>(
    async (previous, formData) => updateOfferStock(previous, formData),
    null,
  );

  const inputId = `stock-${offer.id}`;

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="offerId" value={offer.id} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={inputId} className="sr-only">
          {t('stockFor', { sku: offer.sku })}
        </label>
        <input
          id={inputId}
          type="number"
          name="stockOnHand"
          min={0}
          step={1}
          defaultValue={offer.stockOnHand}
          className="h-9 w-20 rounded-sm border border-line-strong bg-surface px-2 text-sm"
        />
        <SubmitButton size="sm" variant="secondary">
          {t('save')}
        </SubmitButton>
      </div>
      {state?.ok && (
        <p role="status" aria-live="polite" className="text-[13px] text-success">
          {t('saved')}
        </p>
      )}
      {state && !state.ok && (
        <p role="alert" className="text-[13px] text-error">
          {t(`errors.${offerErrorLeaf(state.error)}`)}
        </p>
      )}
    </form>
  );
}

/** Pause takes a live offer off the storefront; resume sends it back for review. */
function PauseCell({ offer }: { offer: OfferRow }) {
  const t = useTranslations('merchant.offers');
  const [state, action] = useActionState<OfferState, FormData>(
    async (previous, formData) => setOfferStatus(previous, formData),
    null,
  );

  if (offer.status !== 'approved' && offer.status !== 'paused') return null;

  const pausing = offer.status === 'approved';

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="offerId" value={offer.id} />
      <input type="hidden" name="status" value={pausing ? 'paused' : 'pending_review'} />
      <SubmitButton size="sm" variant="ghost">
        {pausing ? (
          <Pause className="size-3.5" aria-hidden="true" />
        ) : (
          <Play className="size-3.5" aria-hidden="true" />
        )}
        {pausing ? t('pause') : t('resume')}
      </SubmitButton>
      {state && !state.ok && <Alert tone="error">{t(`errors.${offerErrorLeaf(state.error)}`)}</Alert>}
    </form>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
    >
      {children}
    </th>
  );
}

function StatusChip({ status, label }: { status: OfferRow['status']; label: string }) {
  const tone =
    status === 'approved'
      ? 'bg-success text-white'
      : status === 'pending_review'
        ? 'bg-warning text-white'
        : status === 'rejected'
          ? 'bg-error text-white'
          : 'bg-ink-600 text-white';

  return (
    <span
      className={cn('inline-block rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold', tone)}
    >
      {label}
    </span>
  );
}
