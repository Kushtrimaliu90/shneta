'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';

type Status = 'ok' | 'invalid' | 'throttled';

const STATUSES = new Set<string>(['ok', 'invalid', 'throttled']);

/** The query string is only read once, after hydration — nothing to subscribe to. */
const subscribe = () => () => {};
const readStatus = (): string | null =>
  new URLSearchParams(window.location.search).get('newsletter');
const serverSnapshot = (): string | null => null;

/**
 * Feedback for the no-JavaScript newsletter form, which posts to `/api/newsletter` and is
 * redirected back with `?newsletter=<status>`.
 *
 * Two constraints shape this:
 *
 *  1. It cannot use `useSearchParams` — that would opt every page containing the footer
 *     out of static rendering and break the ISR strategy in docs/02 §5, the same trap as
 *     the locale switcher.
 *  2. It should not `setState` inside an effect either. That is the obvious workaround and
 *     it causes a cascading render (`react-hooks/set-state-in-effect`).
 *
 * `useSyncExternalStore` is the construct for exactly this: read a browser-only value with
 * a defined server snapshot, no effect, no second render pass.
 */
export function NewsletterStatus() {
  const raw = useSyncExternalStore(subscribe, readStatus, serverSnapshot);
  const t = useTranslations('footer.newsletter');

  if (!raw || !STATUSES.has(raw)) return null;
  const status = raw as Status;

  return (
    <p
      // docs/04 §10 — async results are announced.
      role="status"
      aria-live="polite"
      className={status === 'ok' ? 'mt-3 text-sm text-signal-400' : 'mt-3 text-sm text-white/80'}
    >
      {t(status === 'ok' ? 'success' : status === 'throttled' ? 'throttled' : 'invalid')}
    </p>
  );
}
