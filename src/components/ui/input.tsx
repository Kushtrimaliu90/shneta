import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — 44px touch target, radius-sm, `line-strong` border.
 *
 * The border is `line-strong` (3.92:1) and not `line` (1.17:1): an input boundary is a UI
 * component under WCAG SC 1.4.11 and must clear 3:1 (docs/13 §C). Focus styling comes from
 * the global `:focus-visible` rule.
 */
export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900 placeholder:text-ink-500',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-2 aria-[invalid=true]:border-error',
        className,
      )}
      {...props}
    />
  );
}
