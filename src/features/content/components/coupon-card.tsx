'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import type { PublicCoupon } from '@/features/content/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §11 — a claimable code with a copy button.
 *
 * The code is also selectable text, not only a button. A copy button that fails silently — no
 * clipboard permission, an insecure origin, a browser that refuses — would otherwise leave the
 * visitor with a discount they can see and cannot use.
 */
export function CouponCard({ coupon }: { coupon: PublicCoupon }) {
  const t = useTranslations('offers');
  const locale = useLocale() as Locale;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Nothing broke; the code is on screen and selectable. */
    }
  }

  const headline =
    coupon.type === 'percentage'
      ? t('percentOff', { value: coupon.value })
      : coupon.type === 'free_shipping'
        ? t('freeShipping')
        : t('fixedOff', { amount: formatPrice(coupon.value, locale) });

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <p className="font-display text-xl font-semibold text-forest-900">{headline}</p>

      <div className="flex flex-col gap-0.5 text-sm text-ink-600">
        {coupon.minSubtotalCents !== null && coupon.minSubtotalCents > 0 && (
          <p data-numeric>
            {t('minSpend', { amount: formatPrice(coupon.minSubtotalCents, locale) })}
          </p>
        )}
        {coupon.endsAt && <p data-numeric>{t('endsOn', { date: coupon.endsAt.slice(0, 10) })}</p>}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <code
          className="flex-1 rounded-sm border border-dashed border-forest-800 bg-forest-50 px-3 py-2 text-center font-ui text-sm font-semibold tracking-wider text-forest-900"
          data-numeric
        >
          {coupon.code}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`${t('copyCode')}: ${coupon.code}`}
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-sm border border-line-strong transition-colors hover:bg-forest-50',
            copied && 'border-success text-success',
          )}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </li>
  );
}
