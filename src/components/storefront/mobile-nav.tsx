'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { isActiveNavPath, PRIMARY_NAV } from '@/components/storefront/nav-links';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { cn } from '@/lib/utils';

/**
 * The sheet's bottom-anchored secondary group. Below `sm` these three are otherwise unreachable
 * from the chrome — the account icon and the locale switcher hide at that width, and Order lookup
 * and Contact lived only in the footer. Labels reuse the keys those surfaces already define
 * (`common.account`, `footer.orderLookup`, `footer.contact`) rather than minting near-duplicates.
 */
const SECONDARY_LINKS = [
  { key: 'common.account', href: '/account' },
  { key: 'footer.orderLookup', href: '/order-lookup' },
  { key: 'footer.contact', href: '/contact' },
] as const;

/**
 * docs/04 §6 — the navbar collapses to a full-screen sheet at ≤ 1024px.
 *
 * Accessibility contract (docs/04 §10, docs/09 §4): focus moves into the sheet on open and
 * returns to the trigger on close, Escape closes, background scroll is locked, and the
 * trigger carries `aria-expanded` / `aria-controls`.
 *
 * ── Motion: CSS-only, enter-only ──
 *
 * The sheet used to snap in with zero transition. It now fades and settles 8px upward over
 * `--duration-ui`, declared through `@starting-style` (`starting:`) exactly like `MobileBuyBar`:
 * the `hidden` attribute is `display: none !important` (preflight), so removing it renders the
 * panel afresh and the starting values transition to rest. The translate half sits inside
 * `motion-safe`, so reduced-motion gets the fade alone (and the global 0.01ms override makes even
 * that instant). Close stays instant — `hidden` returns and there is nothing to animate.
 * Framer Motion stays out of the header's critical path (docs/13 §E).
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  const pathname = usePathname();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      /*
       * close(), not setOpen(false): the panel is `hidden` once closed, so the focused link
       * goes display:none and the browser drops focus to <body>. close() restores it to the
       * trigger — the same contract the X button and every sheet link already honour.
       */
      if (event.key === 'Escape') close();
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
    };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('common.openMenu')}
        className="inline-flex size-11 items-center justify-center rounded-md text-forest-800 hover:bg-forest-50 lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <div
        id={panelId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.primary')}
        hidden={!open}
        data-state={open ? 'open' : 'closed'}
        className={cn(
          /* `fixed inset-0` — e2e/shell.spec.ts asserts the panel fills the viewport. */
          'fixed inset-0 z-50 flex flex-col bg-cream lg:hidden',
          'motion-safe:transition-[opacity,translate] motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)]',
          'starting:opacity-0 motion-safe:starting:translate-y-2',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
          <LocaleSwitcher />
          <button
            type="button"
            onClick={close}
            aria-label={t('common.closeMenu')}
            className="inline-flex size-11 items-center justify-center rounded-md text-forest-800 hover:bg-forest-50"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/*
          One nav landmark holding both groups: the primary list scrolls if it must, the
          secondary group stays anchored to the sheet's bottom edge above a hairline — the
          lower half of the sheet was dead space before it.
        */}
        <nav aria-label={t('nav.primary')} className="flex min-h-0 flex-1 flex-col">
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-5 py-6">
            {PRIMARY_NAV.map((link) => {
              const active = isActiveNavPath(pathname, link.href);
              return (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center rounded-md px-3 py-3 font-display text-2xl hover:bg-forest-50',
                      /* The desktop bar's active pill, at sheet scale (docs/04 §3). */
                      active ? 'bg-forest-50 text-forest-700' : 'text-forest-900',
                    )}
                  >
                    {t(`nav.${link.key}`)}
                  </Link>
                </li>
              );
            })}
            {/* Outside `PRIMARY_NAV` for the reason the desktop bar gives: it is not a category. */}
            {/* And still the sheet's one lime accent (docs/04 §1). */}
            <li>
              <Link
                href="/biohack"
                onClick={close}
                aria-current={isActiveNavPath(pathname, '/biohack') ? 'page' : undefined}
                className="mt-2 flex min-h-11 items-center rounded-md border border-lime-500/60 bg-lime-500/10 px-3 py-3 font-display text-2xl text-forest-800 hover:bg-lime-500/20"
              >
                {t('nav.biohack')}
              </Link>
            </li>
          </ul>

          {/* Quieter on purpose: 15px Inter against the display-face primary list. */}
          <ul className="shrink-0 border-t border-line px-5 py-4">
            {SECONDARY_LINKS.map((link) => {
              const active = isActiveNavPath(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center rounded-md px-3 text-[15px] font-medium hover:bg-forest-50 hover:text-forest-800',
                      active ? 'bg-forest-50 text-forest-700' : 'text-ink-600',
                    )}
                  >
                    {t(link.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
