'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FREQUENCIES } from '@/features/subscriptions/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §3 and docs/07 §8.1 — one-time versus subscribe, inside the buy box.
 *
 * A radio pair, not a checkbox: "one-time" is a real choice a customer is making, and a
 * pre-ticked "subscribe and save" that they have to notice and untick is the pattern that gets
 * shops written about. One-time is selected by default and the discount is stated plainly.
 *
 * The control writes a hidden `subscribeFrequencyDays` into the buy box's existing form, so
 * add-to-cart stays one submission. There is no separate "subscribe" button, because the
 * decision is about *this* purchase, not a different one.
 *
 * The copy says payment is on delivery every time. Until saved cards exist, a subscription is a
 * standing arrangement to be *sent* something, not permission to charge — and docs/07 §8.3 is
 * explicit that this must be said rather than implied.
 */
export function SubscribeToggle({ discountPct }: { discountPct: number }) {
  const t = useTranslations('subscribe');
  const [subscribed, setSubscribed] = useState(false);
  const [frequency, setFrequency] = useState<number>(30);

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      {subscribed && (
        <input type="hidden" name="subscribeFrequencyDays" value={frequency} />
      )}

      <fieldset>
        <legend className="sr-only">{t('frequency')}</legend>

        <div className="flex flex-col gap-2">
          {[false, true].map((wantsSubscription) => {
            const active = subscribed === wantsSubscription;
            return (
              <label
                key={String(wantsSubscription)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-sm border px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-forest-800 bg-forest-50 font-medium text-forest-900'
                    : 'border-line-strong text-ink-900 hover:bg-forest-50',
                )}
              >
                <input
                  type="radio"
                  name="purchaseMode"
                  value={wantsSubscription ? 'subscribe' : 'once'}
                  checked={active}
                  onChange={() => setSubscribed(wantsSubscription)}
                  className="size-4"
                />
                {wantsSubscription ? t('subscribe', { pct: discountPct }) : t('oneTime')}
              </label>
            );
          })}
        </div>
      </fieldset>

      {subscribed && (
        <div className="mt-3 border-t border-line pt-3">
          <label htmlFor="subscribe-frequency" className="block text-xs font-medium text-ink-900">
            {t('frequency')}
          </label>
          <select
            id="subscribe-frequency"
            value={frequency}
            onChange={(event) => setFrequency(Number(event.target.value))}
            className="mt-1 h-10 w-full max-w-40 rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900"
          >
            {FREQUENCIES.map((days) => (
              <option key={days} value={days}>
                {t('days', { count: days })}
              </option>
            ))}
          </select>

          <p className="mt-2 text-xs leading-relaxed text-ink-600">{t('note')}</p>
        </div>
      )}
    </div>
  );
}
