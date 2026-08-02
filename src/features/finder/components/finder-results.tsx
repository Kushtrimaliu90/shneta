'use client';

import { useActionState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { ProductCard } from '@/components/storefront/product-card';
import { notifyCartChanged } from '@/features/cart/cart-events';
import {
  addRoutineToCart,
  saveSubmission,
  type FinderErrorKey,
  type FinderState,
} from '@/features/finder/actions';
import type { ProductListItem } from '@/features/catalog/types';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';

export interface RoutineItem {
  product: ProductListItem;
  /** Pre-localized on the server — the "why" line under each card. */
  why: string;
}

/**
 * docs/05 §10 — "Your routine".
 *
 * The completeness ring is an SVG rather than a progress bar because it is the one number on the
 * page that is about the *set* rather than any single product, and it should not read like
 * another product attribute.
 */
export function FinderResults({
  items,
  completenessPercent,
  isFallback,
  answersJson,
}: {
  items: RoutineItem[];
  completenessPercent: number;
  isFallback: boolean;
  answersJson: string;
}) {
  const t = useTranslations('finder');
  const locale = useLocale() as Locale;

  const [cartState, cartAction] = useActionState<FinderState, FormData>(addRoutineToCart, null);
  const [saveState, saveAction] = useActionState<FinderState, FormData>(saveSubmission, null);

  // Five products at once is the biggest single change the badge ever sees.
  useEffect(() => {
    if (cartState?.ok) notifyCartChanged();
  }, [cartState]);

  const monthlyTotal = items.reduce((sum, item) => sum + item.product.priceCents, 0);
  const variantIds = items.map((item) => item.product.variantId).join(',');
  const productIds = items.map((item) => item.product.id).join(',');

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
        <p className="font-display text-lg font-semibold text-forest-900">{t('emptyTitle')}</p>
        <p className="mt-1.5 text-sm text-ink-600">{t('emptyBody')}</p>
        <Link
          href="/shop"
          className="mt-4 inline-flex h-11 items-center rounded-sm bg-forest-800 px-5 text-base text-white hover:bg-forest-700"
        >
          {t('resultsTitle')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900 sm:text-3xl">
            {t('resultsTitle')}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {t('resultsSubtitle', { count: items.length })}
          </p>
          <p className="mt-0.5 text-sm text-ink-900" data-numeric>
            {t('monthlyTotal', { total: formatPrice(monthlyTotal, locale) })}
          </p>
        </div>

        <CompletenessRing percent={completenessPercent} label={t('completeness', { percent: completenessPercent })} />
      </div>

      {/* docs/05 §10 — "results never empty (fallback to bestsellers with notice)". The notice. */}
      {isFallback && (
        <Alert tone="info" className="mt-4">
          {t('fallbackNotice')}
        </Alert>
      )}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.product.id} className="flex flex-col">
            <ProductCard product={item.product} className="w-full" />
            <p className="mt-1.5 px-1 text-xs text-ink-600">{item.why}</p>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <form action={cartAction}>
          <input type="hidden" name="variantIds" value={variantIds} />
          <SubmitButton loadingLabel={t('adding')}>{t('addAll')}</SubmitButton>
        </form>

        <form action={saveAction} className="flex items-end gap-2">
          <input type="hidden" name="answers" value={answersJson} />
          <input type="hidden" name="productIds" value={productIds} />
          <div>
            <label htmlFor="save-email" className="sr-only">
              {t('emailLabel')}
            </label>
            <input
              id="save-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              className="h-11 w-56 rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900"
            />
          </div>
          <SubmitButton variant="secondary" loadingLabel={t('adding')}>
            {t('saveRoutine')}
          </SubmitButton>
        </form>
      </div>

      {cartState?.ok && (
        <Alert tone="success" className="mt-3">
          {t('added')}
        </Alert>
      )}
      {cartState && !cartState.ok && (
        <Alert tone="error" className="mt-3">
          {t(`errors.${cartState.error.split('.').pop()}` as 'errors.generic')}
        </Alert>
      )}
      {saveState?.ok && (
        <Alert tone="success" className="mt-3">
          {t('saved')}
        </Alert>
      )}

      <p className="mt-8 max-w-prose text-xs text-ink-600">{t('disclaimer')}</p>
    </div>
  );
}

/** The completeness ring — one number, drawn rather than written. */
function CompletenessRing({ percent, label }: { percent: number; label: string }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      <svg width="80" height="80" viewBox="0 0 80 80" role="img" aria-label={label}>
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-forest-100" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 40 40)"
          className="stroke-forest-800"
        />
        <text
          x="40"
          y="45"
          textAnchor="middle"
          className="fill-forest-900 font-ui text-base font-semibold"
        >
          {percent}%
        </text>
      </svg>
      <p className="max-w-32 text-xs text-ink-600">{label}</p>
    </div>
  );
}

/** Keeps the union honest — every error key must be renderable. */
export type _FinderErrorKeys = FinderErrorKey;
