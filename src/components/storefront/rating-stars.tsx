import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — stars plus a count.
 *
 * The stars are `aria-hidden` and the rating is announced as text instead: five icons where
 * three are filled is a picture, not a value, and reading "star star star" tells a screen
 * reader user nothing (docs/04 §10 — colour and shape are never the only carrier).
 */
export function RatingStars({
  rating,
  count,
  size = 'sm',
  className,
}: {
  rating: number;
  count: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const t = useTranslations('product');
  const starSize = size === 'md' ? 'size-4' : 'size-3.5';

  // docs/04 §9 — an honest empty state beats a row of grey stars implying zero out of five.
  if (count === 0) {
    return <p className={cn('text-sm text-ink-500', className)}>{t('noReviewsYet')}</p>;
  }

  const rounded = Math.round(rating);

  return (
    <p className={cn('flex items-center gap-1.5', className)}>
      <span className="flex" aria-hidden="true">
        {/*
          Forest, not lime. docs/04 §3 scopes lime-500 to the CTA hover ring, the vitality ring and
          the New/In-stock badges — one accent per viewport — and a reviewed catalogue would repeat
          a lime star row on every card in the grid.
        */}
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              starSize,
              star <= rounded ? 'fill-forest-500 text-forest-500' : 'text-line-strong',
            )}
          />
        ))}
      </span>
      <span className="text-sm text-ink-600" data-numeric>
        {t('ratingSummary', { rating: rating.toFixed(1), count })}
      </span>
    </p>
  );
}
