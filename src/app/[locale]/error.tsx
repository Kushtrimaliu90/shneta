'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

/**
 * docs/02 §10 — friendly, localized, one retry action. Raw error strings are never shown
 * (docs/04 §9); the digest is logged so it can be correlated with Sentry.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');

  useEffect(() => {
    logger.error('Unhandled storefront error', { digest: error.digest });
  }, [error]);

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <AlertTriangle className="size-10 text-warning" aria-hidden="true" />
      <h1 className="mt-6 font-display text-3xl font-semibold text-forest-900">{t('title')}</h1>
      <p className="mt-3 max-w-md text-ink-600">{t('body')}</p>
      <Button size="lg" className="mt-8" onClick={reset}>
        {t('cta')}
      </Button>
    </div>
  );
}
