import { useLocale, useTranslations } from 'next-intl';
import { formatPrice, percentOff } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — price plus struck compare-at plus a discount badge.
 *
 * Tabular numerals via `data-numeric` so prices align in a grid, and the struck price is
 * marked up as `<s>` with a screen-reader label: a line-through is a visual convention and
 * conveys nothing to a screen reader on its own (docs/04 §10).
 */
export function PriceTag({
  priceCents,
  compareAtPriceCents,
  size = 'md',
  showDiscountBadge = true,
  className,
}: {
  priceCents: number;
  compareAtPriceCents?: number | null;
  size?: 'sm' | 'md' | 'lg';
  /**
   * The product card sets this false and draws the badge on the image tile instead.
   *
   * Inline, the badge is a third item on the price line, and at card width it wraps below — which puts
   * the price of a discounted product at a different height from its neighbour. Reserving space for the
   * wrap was the old fix and cost every card ~24px of nothing. Moving the badge is free and puts the
   * discount where it is visible while scanning a grid.
   */
  showDiscountBadge?: boolean;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('product');
  const discount = percentOff(priceCents, compareAtPriceCents);

  return (
    <p className={cn('flex flex-wrap items-baseline gap-2', className)} data-numeric>
      <span
        className={cn(
          'font-semibold text-forest-900',
          size === 'lg' && 'text-2xl',
          size === 'md' && 'text-lg',
          size === 'sm' && 'text-base',
        )}
      >
        {formatPrice(priceCents, locale)}
      </span>

      {discount !== null && compareAtPriceCents != null && (
        <>
          <s className="text-sm text-ink-500">
            <span className="sr-only">{t('wasPrice')} </span>
            {formatPrice(compareAtPriceCents, locale)}
          </s>
          {showDiscountBadge && (
            <span className="rounded-sm bg-forest-800 px-1.5 py-0.5 text-xs font-semibold text-white">
              −{discount}%
            </span>
          )}
        </>
      )}
    </p>
  );
}
