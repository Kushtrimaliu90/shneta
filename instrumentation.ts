import * as Sentry from '@sentry/nextjs';
import { SENTRY_ENABLED, sharedOptions } from '@/lib/sentry-options';

/**
 * docs/02 §10 — server and edge runtime initialisation.
 *
 * Next.js calls `register()` once per runtime before any other code. Guarded on the DSN so
 * an environment without Sentry pays nothing and boots identically.
 */
export async function register() {
  if (!SENTRY_ENABLED) return;

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(sharedOptions);
  }
}

/**
 * Captures errors thrown inside React Server Components, server actions and route
 * handlers — the paths a plain `try/catch` in application code never sees.
 */
export const onRequestError = SENTRY_ENABLED ? Sentry.captureRequestError : undefined;
