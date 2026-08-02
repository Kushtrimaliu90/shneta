'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * docs/05 §16 — the cookie banner, and the thing it actually gates.
 *
 * **Nothing analytics-related loads until this says yes.** That is the entire point, and it is
 * why the decision lives here rather than in a script tag in the layout: a banner that appears
 * *beside* an already-running tracker is theatre, and under GDPR it is worse than none — it
 * documents that consent was asked for and ignored.
 *
 * Only two buttons. A "manage preferences" panel with one toggle in it is a way of making
 * rejection slower than acceptance, and there is exactly one non-essential category here.
 *
 * The choice is a plain cookie rather than `localStorage`: the server may eventually want to
 * know (to decide whether to render an analytics script at all), and a value the server can
 * read without JavaScript is the one that keeps that door open.
 */

const CONSENT_COOKIE = 'biocode_consent';
const CONSENT_MAX_AGE = 180 * 24 * 60 * 60;

export type ConsentChoice = 'accepted' | 'rejected';

function readConsent(): ConsentChoice | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const value = match?.slice(CONSENT_COOKIE.length + 1);
  return value === 'accepted' || value === 'rejected' ? value : null;
}

function writeConsent(choice: ConsentChoice): void {
  document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=${CONSENT_MAX_AGE}; samesite=lax`;
}

export function CookieConsent() {
  const t = useTranslations('consent');
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);

  /*
   * Read after mount, not during render. The server has no idea what this visitor chose, so
   * deciding during render would hydrate one thing and re-render another — and the flash would
   * be a consent banner appearing for a second on every page for somebody who already answered.
   */
  useEffect(() => {
    setChoice(readConsent());
    setReady(true);
  }, []);

  useEffect(() => {
    if (choice === 'accepted') void loadAnalytics();
  }, [choice]);

  if (!ready || choice !== null) return null;

  return (
    <div
      role="dialog"
      aria-label={t('title')}
      className="border-t border-line bg-surface shadow-lg"
    >
      <div className="container-page flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-ink-600">
          {t('body')}{' '}
          <Link
            href="/legal/privacy"
            className="rounded-sm text-carbon-800 underline underline-offset-4"
          >
            {t('privacyLink')}
          </Link>
        </p>

        <div className="flex shrink-0 gap-2">
          {/*
            Reject first in the DOM and equal in weight. A banner where "accept" is a filled
            button and "reject" is a grey link is the pattern regulators single out.
          */}
          <button
            type="button"
            onClick={() => {
              writeConsent('rejected');
              setChoice('rejected');
            }}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
          >
            {t('reject')}
          </button>
          <button
            type="button"
            onClick={() => {
              writeConsent('accepted');
              setChoice('accepted');
            }}
            className={cn(buttonVariants({ size: 'sm' }))}
          >
            {t('accept')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Loads the analytics client, once, and only after consent.
 *
 * Dynamically imported so the bundle does not carry it for a visitor who declines — the same
 * reasoning as the Sentry browser SDK (docs/13 §G3) and the Supabase client in the media tab.
 * With no measurement id configured it is a no-op, which is the current state: nothing is
 * wired up yet, and this is the gate it will have to pass through when it is.
 */
async function loadAnalytics(): Promise<void> {
  const { initAnalytics } = await import('@/lib/analytics');
  initAnalytics();
}
