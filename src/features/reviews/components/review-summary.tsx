'use client';

import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { VitalityRing } from '@/components/shared/vitality-ring';
import type { ReviewSummary as Summary } from '@/features/reviews/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §3 — the average, the count and a five-bar distribution.
 *
 * The bars are buttons: clicking "4 stars" filters the list below to four-star reviews. That is
 * the only reason a distribution is worth rendering — as a picture it says little that the
 * average does not, but as a filter it answers "what do the unhappy ones say", which is the
 * question a shopper actually has.
 *
 * A bar with no reviews is disabled rather than hidden, so the row of five stays stable and the
 * gap itself is information.
 */
export function ReviewSummaryPanel({
  summary,
  activeRating,
  onSelectRating,
}: {
  summary: Summary;
  activeRating: number | null;
  onSelectRating: (rating: number | null) => void;
}) {
  const t = useTranslations('review');

  if (summary.total === 0) return null;

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="shrink-0 text-center sm:text-left">
        {/*
          docs/04 §2 — the PDP rating arc, one of the Vitality Ring's four sanctioned uses and
          the only lime in this panel. Decorative (no label): the figure inside it and the count
          under it carry the value as text, so the arc repeats rather than states. 76px, not the
          component's 48 default — the text-4xl figure needs a 61px chord to sit inside the
          stroke without touching it.
        */}
        <div className="relative mx-auto size-[76px] sm:mx-0">
          <VitalityRing value={summary.average / 5} size={76} strokeWidth={5} />
          <p
            className="absolute inset-0 flex items-center justify-center font-display text-4xl font-semibold text-forest-900"
            data-numeric
          >
            {summary.average.toFixed(1)}
          </p>
        </div>
        {/*
          Forest for the stars and the bars, matching `rating-stars.tsx`: the ring above is this
          panel's one lime accent (docs/04 §3), and six more lime fills beside it would make the
          accent a wash.
        */}
        <span className="mt-1 flex justify-center sm:justify-start" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star
              key={star}
              className={cn(
                'size-4',
                star <= Math.round(summary.average)
                  ? 'fill-forest-500 text-forest-500'
                  : 'text-line-strong',
              )}
            />
          ))}
        </span>
        <p className="mt-1 text-sm text-ink-600" data-numeric>
          {t('countLabel', { count: summary.total })}
        </p>
      </div>

      <ul className="flex flex-1 flex-col gap-1.5">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.distribution[star - 1] ?? 0;
          const percent = summary.total === 0 ? 0 : Math.round((count / summary.total) * 100);
          const isActive = activeRating === star;

          return (
            <li key={star}>
              <button
                type="button"
                disabled={count === 0}
                aria-pressed={isActive}
                onClick={() => onSelectRating(isActive ? null : star)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left text-sm transition-colors',
                  count === 0 ? 'cursor-default opacity-60' : 'hover:bg-forest-50',
                  isActive && 'bg-forest-100',
                )}
              >
                <span className="w-14 shrink-0 text-ink-600" data-numeric>
                  {t('starsShort', { count: star })}
                </span>
                <span
                  aria-hidden="true"
                  className="h-2 flex-1 overflow-hidden rounded-full bg-forest-50"
                >
                  <span
                    className="block h-full rounded-full bg-forest-500"
                    style={{ width: `${percent}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-ink-600" data-numeric>
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
