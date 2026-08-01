'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { ProductImage } from '@/components/storefront/product-image';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import {
  cancelSubscription,
  changeFrequency,
  pauseSubscription,
  resumeSubscription,
  skipNextDelivery,
  updateSubscriptionItem,
  type SubscriptionState,
} from '@/features/subscriptions/actions';
import { FREQUENCIES, type SubscriptionView } from '@/features/subscriptions/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §14 and docs/07 §8.3 — one subscription, with every control the customer is owed.
 *
 * "All customer-side actions instant, no penalties." So skip and pause are single buttons with
 * no confirmation, cancel asks once because it is not reversible, and the reason field on it is
 * optional — requiring one is a retention dark pattern, and an unanswered dropdown is worse data
 * than an empty field.
 *
 * Each control is its own `<form>` posting its own action, for the reason the product editor
 * gives: one form spanning six controls would make "save" mean six things and let a failure in
 * one lose the others.
 */
export function SubscriptionCard({ subscription }: { subscription: SubscriptionView }) {
  const t = useTranslations('account.subscriptions');
  const tRoot = useTranslations();
  const locale = useLocale() as Locale;
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [editingFrequency, setEditingFrequency] = useState(false);

  const [skipState, skipAction] = useActionState<SubscriptionState, FormData>(
    skipNextDelivery,
    null,
  );
  const [pauseState, pauseAction] = useActionState<SubscriptionState, FormData>(
    pauseSubscription,
    null,
  );
  const [resumeState, resumeAction] = useActionState<SubscriptionState, FormData>(
    resumeSubscription,
    null,
  );
  const [frequencyState, frequencyAction] = useActionState<SubscriptionState, FormData>(
    changeFrequency,
    null,
  );
  const [cancelState, cancelAction] = useActionState<SubscriptionState, FormData>(
    cancelSubscription,
    null,
  );

  const failure = [skipState, pauseState, resumeState, frequencyState, cancelState].find(
    (state) => state && !state.ok,
  );

  const isCancelled = subscription.status === 'cancelled';
  const isPaused = subscription.status === 'paused';
  const total = subscription.subtotalCents - subscription.discountCents;

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface p-4',
        isCancelled ? 'border-line opacity-70' : 'border-line-strong',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-semibold text-forest-900">
            <CalendarClock className="size-5 text-forest-800" aria-hidden="true" />
            {t('everyDays', { count: subscription.frequencyDays })}
          </p>

          <p className="mt-1 text-sm text-ink-600" data-numeric>
            {isCancelled
              ? t('cancelledOn', { date: (subscription.cancelledAt ?? '').slice(0, 10) })
              : isPaused
                ? subscription.pausedUntil
                  ? t('pausedUntil', { date: subscription.pausedUntil.slice(0, 10) })
                  : t('pausedIndefinitely')
                : t('nextDelivery', { date: subscription.nextRunAt.slice(0, 10) })}
          </p>
        </div>

        <span
          className={cn(
            'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
            isCancelled
              ? 'bg-ink-600 text-white'
              : isPaused
                ? 'bg-warning text-white'
                : 'bg-success text-white',
          )}
        >
          {isCancelled ? t('statusCancelled') : isPaused ? t('statusPaused') : t('statusActive')}
        </span>
      </div>

      {/*
        docs/07 §8.2 — after three failed runs the engine pauses it. The customer needs to know
        why, and the most likely cause is right below: an item that is no longer available.
      */}
      {subscription.consecutiveFailures > 0 && !isCancelled && (
        <Alert tone="error" className="mt-3">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('failuresWarning', { count: subscription.consecutiveFailures })}
          </span>
        </Alert>
      )}

      <h3 className="mt-4 font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        {t('itemsHeading')}
      </h3>

      <ul className="mt-2 flex flex-col gap-2">
        {subscription.items.map((item) => {
          const name = pickLocale(item.productName, locale);
          const variantName = pickLocale(item.variantName, locale);

          return (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-3 rounded-sm border border-line p-2',
                !item.isAvailable && 'opacity-70',
              )}
            >
              <div className="size-12 shrink-0 overflow-hidden rounded-sm bg-cream">
                <ProductImage
                  path={item.imagePath}
                  alt={name}
                  sizes="48px"
                  className="size-12 p-1"
                />
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/product/${item.productSlug}`}
                  className={cn(
                    'rounded-sm text-sm font-medium text-ink-900 hover:text-forest-800',
                    !item.isAvailable && 'line-through',
                  )}
                >
                  {name}
                </Link>
                {variantName && <p className="text-xs text-ink-500">{variantName}</p>}
                {!item.isAvailable && (
                  <p className="mt-0.5 text-xs text-warning">{t('unavailable')}</p>
                )}
              </div>

              {!isCancelled ? (
                <QuantityForm
                  subscriptionId={subscription.id}
                  itemId={item.id}
                  quantity={item.quantity}
                  removable={subscription.items.length > 1}
                />
              ) : (
                <span className="text-sm text-ink-600" data-numeric>
                  ×{item.quantity}
                </span>
              )}

              <span className="w-20 shrink-0 text-right text-sm text-ink-900" data-numeric>
                {formatPrice(item.priceCents * item.quantity, locale)}
              </span>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-600">{t('subtotal')}</dt>
          <dd className="text-ink-900" data-numeric>
            {formatPrice(subscription.subtotalCents, locale)}
          </dd>
        </div>
        {subscription.discountCents > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-600">
              {t('discount')} <span data-numeric>({subscription.discountPct}%)</span>
            </dt>
            <dd className="text-success" data-numeric>
              −{formatPrice(subscription.discountCents, locale)}
            </dd>
          </div>
        )}
        <div className="flex justify-between font-medium">
          <dt className="text-ink-900">{t('subtotal')}</dt>
          <dd className="text-forest-900" data-numeric>
            {formatPrice(total, locale)}
          </dd>
        </div>
      </dl>

      {/* docs/07 §8.3 — the COD model, said plainly rather than implied. */}
      <p className="mt-2 text-xs text-ink-500">{t('codNote')}</p>

      {!isCancelled && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {!isPaused && (
            <form action={skipAction}>
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <SubmitButton size="sm" variant="secondary" loadingLabel={t('skipping')}>
                {t('skip')}
              </SubmitButton>
            </form>
          )}

          {isPaused ? (
            <form action={resumeAction}>
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <SubmitButton size="sm" loadingLabel={t('resuming')}>
                {t('resume')}
              </SubmitButton>
            </form>
          ) : (
            <form action={pauseAction} className="flex items-end gap-2">
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <div>
                <label
                  htmlFor={`resume-${subscription.id}`}
                  className="block text-xs text-ink-600"
                >
                  {t('resumeOn')}
                </label>
                <input
                  id={`resume-${subscription.id}`}
                  type="date"
                  name="resumeOn"
                  className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
                />
              </div>
              <SubmitButton size="sm" variant="secondary" loadingLabel={t('pausing')}>
                {t('pause')}
              </SubmitButton>
            </form>
          )}

          {editingFrequency ? (
            <form action={frequencyAction} className="flex items-end gap-2">
              <input type="hidden" name="subscriptionId" value={subscription.id} />
              <div>
                <label
                  htmlFor={`frequency-${subscription.id}`}
                  className="block text-xs text-ink-600"
                >
                  {t('changeFrequency')}
                </label>
                <select
                  id={`frequency-${subscription.id}`}
                  name="frequencyDays"
                  defaultValue={subscription.frequencyDays}
                  className="mt-1 h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
                >
                  {FREQUENCIES.map((days) => (
                    <option key={days} value={days}>
                      {days}
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton size="sm" loadingLabel={t('saving')}>
                {t('save')}
              </SubmitButton>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingFrequency(true)}
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              {t('changeFrequency')}
            </button>
          )}

          {!confirmingCancel && (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'ml-auto text-ink-600')}
            >
              {t('cancel')}
            </button>
          )}
        </div>
      )}

      {confirmingCancel && (
        <form action={cancelAction} className="mt-3 border-t border-line pt-3">
          <input type="hidden" name="subscriptionId" value={subscription.id} />
          <p className="text-sm font-medium text-ink-900">{t('cancelConfirm')}</p>

          <label
            htmlFor={`reason-${subscription.id}`}
            className="mt-2 block text-xs text-ink-600"
          >
            {t('cancelReason')}
          </label>
          <textarea
            id={`reason-${subscription.id}`}
            name="reason"
            rows={2}
            className="mt-1 w-full max-w-md rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm"
          />

          <div className="mt-2 flex items-center gap-2">
            <SubmitButton size="sm" variant="destructive" loadingLabel={t('cancelling')}>
              {t('cancel')}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              className={buttonVariants({ variant: 'link', size: 'sm' })}
            >
              {t('keepIt')}
            </button>
          </div>
        </form>
      )}

      {subscription.orders.length > 0 && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-forest-800">
            {t('ordersHeading')}{' '}
            <span data-numeric>({subscription.orders.length})</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {subscription.orders.map((order) => (
              <li key={order.orderNumber} className="flex items-center justify-between text-sm">
                <Link
                  href={`/account/orders/${order.orderNumber}`}
                  className="rounded-sm text-forest-800 underline underline-offset-4"
                  data-numeric
                >
                  {order.orderNumber}
                </Link>
                <span className="text-ink-600" data-numeric>
                  {order.placedAt.slice(0, 10)} · {formatPrice(order.totalCents, locale)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {failure && !failure.ok && (
        <Alert tone="error" className="mt-3">
          {tRoot(failure.error)}
        </Alert>
      )}
    </li>
  );
}

/** Quantity for one line: change it, or set it to zero to remove. */
function QuantityForm({
  subscriptionId,
  itemId,
  quantity,
  removable,
}: {
  subscriptionId: string;
  itemId: string;
  quantity: number;
  removable: boolean;
}) {
  const t = useTranslations('account.subscriptions');
  const [, formAction] = useActionState<SubscriptionState, FormData>(
    updateSubscriptionItem,
    null,
  );

  return (
    <form action={formAction} className="flex shrink-0 items-center gap-1">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="itemId" value={itemId} />
      <label htmlFor={`qty-${itemId}`} className="sr-only">
        {t('quantity')}
      </label>
      <select
        id={`qty-${itemId}`}
        name="quantity"
        defaultValue={quantity}
        // Submits on change: a quantity stepper with its own save button is a control people
        // set and then walk away from.
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-sm border border-line-strong bg-surface px-2 text-sm"
        data-numeric
      >
        {/* Zero removes the line — only offered when it is not the last one. */}
        {(removable ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map((value) => (
          <option key={value} value={value}>
            {value === 0 ? t('remove') : value}
          </option>
        ))}
      </select>
    </form>
  );
}
