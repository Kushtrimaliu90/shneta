'use client';

import { useTranslations } from 'next-intl';
import { Scale, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useCompare } from '@/features/compare/components/compare-provider';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * docs/05 §9 — a bar at the bottom of the screen once something is selected.
 *
 * Without it, comparing is invisible: a visitor ticks two products on the shop grid and has no
 * way to find out what the ticks did. The bar is the only affordance that leads to the table.
 *
 * Hidden entirely at zero rather than shown empty — a persistent bar with nothing in it is a
 * permanent strip of chrome across every page for a feature most visits never use.
 *
 * Not `fixed` itself: it is one row of the bottom stack the storefront layout owns. Two
 * independently-fixed bottom bars overlap, and the one that loses is unclickable — which is
 * exactly what happened when the cookie banner landed on top of this (docs/13 §N8).
 */
export function CompareBar() {
  const t = useTranslations('compare');
  const { ids, clear, ready } = useCompare();

  if (!ready || ids.length === 0) return null;

  return (
    <div className="border-t border-line bg-surface/95 backdrop-blur-sm">
      <div className="container-page flex items-center gap-3 py-3">
        <Scale className="size-5 shrink-0 text-forest-800" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm text-ink-900" data-numeric>
          {t('bar', { count: ids.length })}
        </p>

        <Link href={`/compare?ids=${ids.join(',')}`} className={buttonVariants({ size: 'sm' })}>
          {t('open')}
        </Link>

        <button
          type="button"
          onClick={clear}
          aria-label={t('clear')}
          className={cn(
            buttonVariants({ variant: 'link', size: 'sm' }),
            'shrink-0 px-1 text-ink-600',
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
