'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { loadMyAssignedCount } from '@/features/merchants/fulfilment-actions';

/**
 * The portal's live signal for routed orders (owner, 2026-09-01).
 *
 * The assignment email covers the merchant who is away; this covers the one already in the
 * portal, who otherwise learns about a new order by reloading. One component, two outputs:
 * a count badge rendered inline where it is mounted (the nav's Orders item), and a toast
 * portalled to `<body>` when the count RISES mid-session — a rise is a new assignment, so
 * that is the moment worth interrupting for. First load and decreases stay silent: a badge
 * that toasts on mount would greet every visit with old news.
 *
 * Polling, not realtime, on the cart-badge precedent: a 60s doorbell is prompt enough for a
 * parcel that ships within days, and it needs no replication slots, no channels, nothing to
 * reconnect. The interval also re-fires when the tab regains visibility, so a merchant coming
 * back to a background tab is caught up immediately rather than up to a minute later.
 */
const POLL_MS = 60_000;
/** Long enough to read and click; short enough that a missed toast is not a stuck one. */
const TOAST_MS = 12_000;

export function FulfilmentAlerts() {
  const t = useTranslations('merchant.portal.alerts');
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [toastCount, setToastCount] = useState<number | null>(null);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      void loadMyAssignedCount().then((next) => {
        if (!active) return;
        if (previous.current !== null && next > previous.current) setToastCount(next);
        previous.current = next;
        setCount(next);
      });
    };

    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname]);

  useEffect(() => {
    if (toastCount === null) return;
    const timer = window.setTimeout(() => setToastCount(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastCount]);

  return (
    <>
      {count !== null && count > 0 && (
        <span
          aria-label={t('badgeLabel', { count })}
          className="ms-auto min-w-5 rounded-full bg-forest-800 px-1.5 text-center text-[11px] leading-5 font-semibold text-white lg:ms-0"
          data-numeric
        >
          {count > 99 ? '99+' : count}
        </span>
      )}

      {toastCount !== null &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg bg-forest-900 px-4 py-3 text-sm text-cream shadow-lg motion-safe:transition-[opacity,translate] motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)] motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0"
          >
            <span className="min-w-0">
              {t('newAssigned', { count: toastCount })}{' '}
              <Link
                href="/merchant/orders"
                onClick={() => setToastCount(null)}
                className="font-medium underline underline-offset-4 hover:text-white"
              >
                {t('view')}
              </Link>
            </span>
            <button
              type="button"
              onClick={() => setToastCount(null)}
              aria-label={t('dismiss')}
              className="-m-1 shrink-0 rounded-sm p-1 text-cream/70 hover:text-white"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
