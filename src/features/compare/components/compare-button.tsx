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
        /*
            docs/04 §10 — the 44px hit-area floor. The icon variant renders a 36px control, which is
            the right *visual* weight sitting over a product photograph, so the target is grown with a
            pseudo-element instead of the box: `before:-inset-1` puts 4px of invisible target on each
            side, giving 44 x 44. Same device as the carousel dots, and for the same reason — the
            visual stays small, the target does not.

            axe passes either way (WCAG 2.5.8 asks for 24px), so this is the project's own stricter
            rule rather than a compliance fix.
          */
        variant === 'icon'
          ? 'relative size-9 justify-center bg-surface/90 before:absolute before:-inset-1 before:content-[""] hover:bg-surface'
          : 'h-11 px-3 text-sm font-medium hover:bg-forest-50',
        selected ? 'text-forest-900' : 'text-forest-800',
        disabled && !selected && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <Scale className={cn('size-5', selected && 'fill-lime-500/30')} aria-hidden="true" />
      {variant === 'labelled' && <span>{selected ? t('added') : t('add')}</span>}
    </button>
  );
}
