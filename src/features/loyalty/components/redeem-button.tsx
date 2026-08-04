'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Gift } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { redeemLoyalty, type RedeemState } from '@/features/loyalty/actions';
import { cn } from '@/lib/utils';

/**
 * docs/07 §9 — exchange points for a coupon.
 *
 * The code is shown once and is also selectable text, not only a copy button — the same
 * reasoning as the offers page: a clipboard write can fail silently, and a customer who has just
 * spent a hundred points must not be left with a discount they can see and cannot use.
 *
 * Disabled below the threshold rather than hidden, so the customer can see what they are working
 * towards. The balance above it says how far off they are.
 */
export function RedeemButton({
  balance,
  minRedeemPoints,
  pointValueCents,
}: {
  balance: number;
  minRedeemPoints: number;
  pointValueCents: number;
}) {
  const t = useTranslations('account.loyalty');
  const tRoot = useTranslations();
  const locale = useLocale() as Locale;
  const [state, formAction] = useActionState<RedeemState, FormData>(
    async (previous) => redeemLoyalty(previous),
    null,
  );
  const [copied, setCopied] = useState(false);

  /*
   * docs/17 §0.1 — the value of a redemption is now computed, not configured.
   *
   * With one point worth one cent, the old fixed "100 points = €5" tier is gone: the smallest
   * redemption is `min_redeem_points` and it is worth exactly that many cents. The RPC accepts any
   * multiple of 100 at or above the minimum; this button spends the minimum, which is the common case
   * and the only one the current UI offers.
   */
  const redeemPoints = minRedeemPoints;
  const value = formatPrice(redeemPoints * pointValueCents, locale);

  if (state?.ok && state.data) {
    const code = state.data.code;

    async function copy() {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* The code is on screen and selectable; nothing broke. */
      }
    }

    return (
      <Alert tone="success" title={t('redeemedTitle')}>
        <p>{t('redeemedBody', { value: formatPrice(state.data.valueCents, locale) })}</p>
        <div className="mt-3 flex items-center gap-2">
          <code
            className="rounded-sm border border-dashed border-forest-800 bg-surface px-3 py-2 font-ui text-sm font-semibold tracking-wider text-forest-900"
            data-numeric
          >
            {code}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={`${t('copyCode')}: ${code}`}
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-sm border border-line-strong bg-surface hover:bg-forest-50',
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
      </Alert>
    );
  }

  const affordable = balance >= redeemPoints;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-forest-900">
        <Gift className="size-5 text-forest-800" aria-hidden="true" />
        {t('redeemTitle')}
      </h2>
      <p className="mt-1 text-sm text-ink-600">
        {t('redeemBody', { points: redeemPoints, value })}
      </p>

      <form action={formAction} className="mt-3">
        <SubmitButton size="sm" disabled={!affordable} loadingLabel={t('redeeming')}>
          {t('redeem', { points: redeemPoints })}
        </SubmitButton>
      </form>

      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          {tRoot(state.error)}
        </Alert>
      )}

      <p className="mt-3 text-xs leading-relaxed text-ink-500">{t('terms')}</p>
    </div>
  );
}
