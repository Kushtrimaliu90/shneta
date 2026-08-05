'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * docs/05 §2 — the filter panel, as a sidebar on desktop and a sheet on mobile.
 *
 * ── The problem this solves ──
 *
 * The panel renders **51 links across 5 groups**: 16 categories, 20 brands, 9 goals, dietary tags and
 * two availability toggles. In a single column that is roughly 1,900 px, so on a 390 px phone the first
 * product card sat about five screens down. Measured on the live site: the first `<article>` began 27.8
 * kB into the HTML. Someone arriving at "show products" had to scroll past every brand in the shop to
 * see a product.
 *
 * ── Why one instance and not two ──
 *
 * The obvious build is a desktop `<aside>` plus a separate mobile sheet. That renders the 51 links
 * twice: 10 kB of duplicate markup, two elements for every accessible name — which breaks
 * `getByRole('link', { name: 'Vegan' })` for tests and, more importantly, makes a screen reader announce
 * every filter twice.
 *
 * So this is **one node whose presentation changes**. On `lg` it is a static sidebar and the trigger is
 * hidden; below `lg` it is `hidden` until the trigger opens it as a full-screen sheet. The children are
 * the same server-rendered links either way — this component adds behaviour, not markup.
 *
 * ── Accessibility contract ──
 *
 * Copied deliberately from `MobileNav`, which is the established pattern in this codebase (docs/04 §10,
 * docs/09 §4): focus moves into the sheet on open and returns to the trigger on close, Escape closes,
 * background scroll is locked, and the trigger carries `aria-expanded` / `aria-controls`.
 *
 * ── The tradeoff, stated ──
 *
 * With JavaScript off, the trigger does nothing and mobile visitors cannot reach the facets. That
 * matches the nav sheet, the cart drawer and the search overlay, which are all already JS-only — and
 * the main axes stay reachable without it, because `/shop/[category]`, `/brands/[slug]` and
 * `/goals/[slug]` are ordinary server-rendered pages linked from the nav and footer.
 */
export function FilterShell({
  activeCount,
  resultCount,
  children,
}: {
  /** Drives the badge on the trigger, so the count is visible without opening anything. */
  activeCount: number;
  /** "Show 24 products" — the sheet's primary action tells you what you are going back to. */
  resultCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('shop');
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    /*
     * Captured now, not read in the cleanup.
     *
     * By the time the cleanup runs the ref may point somewhere else, and focus would either go nowhere
     * or to whatever replaced the trigger — which for a keyboard user is worse than not restoring it.
     */
    const trigger = triggerRef.current;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, [open]);

  /*
   * Closing on navigation is what makes the sheet feel right rather than clever.
   *
   * Every filter is a real link, so tapping one is a navigation and React re-renders this component
   * with `open` still true — the sheet would stay over the results the visitor just asked to see. The
   * effect below runs on mount of each new page and shuts it.
   */
  useEffect(() => {
    setOpen(false);
  }, [children]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-11 shrink-0 self-start items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 font-ui text-sm font-medium text-ink-900 lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        {t('filters')}
        {activeCount > 0 && (
          <span
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-forest-800 px-1.5 py-0.5 text-xs font-semibold text-white"
            data-numeric
          >
            {activeCount}
          </span>
        )}
      </button>

      {/* The scrim. Tapping outside is how a sheet is dismissed on a phone. */}
      {open && (
        <button
          type="button"
          aria-label={t('closeFilters')}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-forest-950/40 lg:hidden"
        />
      )}

      <div
        ref={panelRef}
        id={panelId}
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? t('filters') : undefined}
        className={cn(
          // Desktop: an ordinary sidebar, exactly as before.
          'lg:block lg:w-60 lg:shrink-0 lg:overflow-visible lg:bg-transparent lg:p-0',
          open
            ? 'fixed inset-x-0 bottom-0 top-14 z-50 overflow-y-auto rounded-t-lg bg-surface p-5 pb-24 lg:static lg:inset-auto lg:rounded-none lg:pb-0'
            : 'hidden',
        )}
      >
        {/*
          The sheet's own header. Sticky, because the whole point is that the way out is always
          within reach — a filter list you have to scroll back up to escape is the problem again.
        */}
        {open && (
          <div className="sticky -top-5 z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between border-b border-line bg-surface px-5 py-3 lg:hidden">
            <h2 className="font-display text-lg font-semibold text-forest-900">{t('filters')}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('closeFilters')}
              className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink-600"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {children}

        {/*
          A fixed footer with the result count, so the sheet answers "what am I about to get?" before
          you close it. The count is already correct — the links navigate, so it reflects the page you
          are on rather than a preview of one you have not asked for yet.
        */}
        {open && (
          <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-4 lg:hidden">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex min-h-11 w-full items-center justify-center rounded-md bg-forest-800 px-4 font-ui text-sm font-semibold text-white"
            >
              {t('showResults', { count: resultCount })}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
