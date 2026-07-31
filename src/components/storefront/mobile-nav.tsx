'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { PRIMARY_NAV } from '@/components/storefront/nav-links';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';

/**
 * docs/04 §6 — the navbar collapses to a full-screen sheet at ≤ 1024px.
 *
 * Accessibility contract (docs/04 §10, docs/09 §4): focus moves into the sheet on open and
 * returns to the trigger on close, Escape closes, background scroll is locked, and the
 * trigger carries `aria-expanded` / `aria-controls`.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();

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
        className="fixed inset-0 z-50 flex flex-col bg-cream lg:hidden"
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
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

        <nav aria-label={t('nav.primary')} className="flex-1 overflow-y-auto px-5 py-6">
          <ul className="flex flex-col gap-1">
            {PRIMARY_NAV.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  onClick={close}
                  className="flex min-h-11 items-center rounded-md px-3 py-3 font-display text-2xl text-forest-900 hover:bg-forest-50"
                >
                  {t(`nav.${link.key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
