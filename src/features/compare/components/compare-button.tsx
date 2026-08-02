'use client';

import { useTranslations } from 'next-intl';
import { Scale } from 'lucide-react';
import { useCompare } from '@/features/compare/components/compare-provider';
import { cn } from '@/lib/utils';

/**
 * docs/05 §9 — the compare toggle on a product card and the PDP.
 *
 * Disabled at four rather than swapping the fifth in, because silently replacing something the
 * visitor chose is worse than refusing: they cannot see what was dropped. The bar at the bottom
 * of the screen says how many are selected and offers to clear them.
 */
export function CompareButton({
  productId,
  productName,
  variant = 'icon',
  className,
}: {
  productId: string;
  productName: string;
  variant?: 'icon' | 'labelled';
  className?: string;
}) {
  const t = useTranslations('compare');
  const { isSelected, toggle, isFull, ready } = useCompare();

  const selected = isSelected(productId);
  const disabled = !ready || (!selected && isFull);
  const label = selected ? t('remove') : t('add');

  return (
    <button
      type="button"
      onClick={() => toggle(productId)}
      disabled={disabled}
      aria-pressed={selected}
      // The name is in the label because a grid otherwise announces two dozen identical buttons.
      aria-label={`${label}: ${productName}`}
      title={disabled && !selected ? t('full') : label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md transition-colors',
        variant === 'icon'
          ? 'size-9 justify-center bg-surface/90 hover:bg-surface'
          : 'h-11 px-3 text-sm font-medium hover:bg-carbon-50',
        selected ? 'text-carbon-900' : 'text-carbon-800',
        disabled && !selected && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <Scale className={cn('size-5', selected && 'fill-signal-500/30')} aria-hidden="true" />
      {variant === 'labelled' && <span>{selected ? t('added') : t('add')}</span>}
    </button>
  );
}
