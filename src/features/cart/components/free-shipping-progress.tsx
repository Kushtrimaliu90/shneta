import { getLocale, getTranslations } from 'next-intl/server';
import { amountToFreeShipping, formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';

/**
 * docs/05 §12 — "Add €X for free delivery".
 *
 * A real `<progress>` element, so assistive technology reads it as a progress indicator
 * without any ARIA of ours, and the sentence above it carries the same information as text —
 * the bar is never the only way to know how close you are.
 */
export async function FreeShippingProgress({
  subtotalCents,
  thresholdCents,
}: {
  subtotalCents: number;
  thresholdCents: number | null;
}) {
  if (thresholdCents == null) return null;

  const t = await getTranslations('cart');
  const locale = (await getLocale()) as Locale;
  const remaining = amountToFreeShipping(subtotalCents, thresholdCents);
  const reached = remaining === 0;

  return (
    <div className="rounded-md bg-carbon-50 p-3">
      <p className={reached ? 'text-sm font-medium text-success' : 'text-sm text-ink-600'}>
        {reached
          ? t('freeShippingReached')
          : t('freeShippingRemaining', { amount: formatPrice(remaining, locale) })}
      </p>
      <progress
        value={Math.min(subtotalCents, thresholdCents)}
        max={thresholdCents}
        className="mt-2 h-1.5 w-full [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-carbon-100 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-signal-500"
      >
        {Math.round((Math.min(subtotalCents, thresholdCents) / thresholdCents) * 100)}%
      </progress>
    </div>
  );
}
