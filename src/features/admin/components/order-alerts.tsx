'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { loadOrderSignals } from '@/features/admin/actions';

/**
 * The admin panel's live doorbell (owner, 2026-09-01).
 *
 * The sidebar's pending badges are correct on every navigation, but an operator parked on one
 * screen — the routing page during the morning batch, say — saw nothing until they clicked
 * something. This polls the three order-flow signals and toasts when one RISES: a new order to
 * confirm, a fulfilment to route, or a merchant ship waiting for the order to be marked shipped
 * (which is what releases the customer's dispatch email). Rises only — the standing backlog is
 * the sidebar's job, and a toast that repeats it on mount teaches people to dismiss toasts.
 *
 * English by design: the admin panel is English-only in v1 (docs/01 §3).
 */
const POLL_MS = 60_000;
const TOAST_MS = 12_000;

interface Signals {
  pendingOrders: number;
  unassigned: number;
  shippedInFlight: number;
}

export function OrderAlerts() {
  const [toast, setToast] = useState<{ message: string; href: string } | null>(null);
  const previous = useRef<Signals | null>(null);

  useEffect(() => {
    let active = true;

    const refresh = () => {
      void loadOrderSignals().then((next) => {
        if (!active) return;
        const before = previous.current;
        previous.current = next;
        if (!before) return;

        /* One toast per poll, most urgent first: money waits on confirm, then routing, then dispatch. */
        if (next.pendingOrders > before.pendingOrders) {
          setToast({
            message: `New order in — ${next.pendingOrders} awaiting confirmation.`,
            href: '/admin/orders',
          });
        } else if (next.unassigned > before.unassigned) {
          setToast({
            message: `${next.unassigned} fulfilment${next.unassigned === 1 ? '' : 's'} awaiting routing.`,
            href: '/admin/routing',
          });
        } else if (next.shippedInFlight > before.shippedInFlight) {
          setToast({
            message: `A merchant shipped — mark the order shipped to send the customer's dispatch email.`,
            href: '/admin/routing',
          });
        }
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
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg bg-forest-900 px-4 py-3 text-sm text-cream shadow-lg motion-safe:transition-[opacity,translate] motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)] motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0"
    >
      <span className="min-w-0">
        {toast.message}{' '}
        <Link
          href={toast.href}
          onClick={() => setToast(null)}
          className="font-medium underline underline-offset-4 hover:text-white"
        >
          Open
        </Link>
      </span>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="-m-1 shrink-0 rounded-sm p-1 text-cream/70 hover:text-white"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
