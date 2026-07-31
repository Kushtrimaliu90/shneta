'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Status = 'ok' | 'invalid' | 'throttled';

const STATUSES = new Set<Status>(['ok', 'invalid', 'throttled']);

/**
 * Feedback for the no-JavaScript newsletter form, which posts to `/api/newsletter` and is
 * redirected back with `?newsletter=<status>`.
 *
 * Reads `window.location.search` after mount rather than calling `useSearchParams`, which
 * would opt every page containing the footer out of static rendering and break the ISR
 * strategy in docs/02 §5 — the same trap as the locale switcher.
 */
export function NewsletterStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const t = useTranslations('footer.newsletter');

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('newsletter');
    if (value && STATUSES.has(value as Status)) setStatus(value as Status);
  }, []);

  if (!status) return null;

  return (
    <p
      // docs/04 §10 — async results are announced.
      role="status"
      aria-live="polite"
      className={status === 'ok' ? 'mt-3 text-sm text-lime-400' : 'mt-3 text-sm text-white/80'}
    >
      {t(status === 'ok' ? 'success' : status === 'throttled' ? 'throttled' : 'invalid')}
    </p>
  );
}
