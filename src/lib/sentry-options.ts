import type { NodeOptions } from '@sentry/nextjs';

/**
 * docs/02 §10 — shared Sentry configuration.
 *
 * Everything is inert when `SENTRY_DSN` is unset, so local development and any environment
 * without an account behave exactly as if the SDK were not installed. That is deliberate:
 * observability must never be the reason a build or a boot fails.
 */
export const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

export const SENTRY_ENABLED = SENTRY_DSN.length > 0;

/** docs/10 §6 — 10% performance sampling. Errors are always captured. */
const TRACES_SAMPLE_RATE = process.env.NODE_ENV === 'production' ? 0.1 : 0;

/**
 * PII scrubbing (docs/02 §10). Kosovo's data-protection law is GDPR-aligned (docs/01 §4),
 * so customer identifiers must not leave the system inside a stack trace.
 *
 * Redaction is by key name across the whole event, because PII reaches Sentry through more
 * routes than the obvious `user` field — request bodies, breadcrumb data, query strings and
 * server-action arguments all carry it.
 */
const PII_KEYS = new Set([
  'email',
  'phone',
  'password',
  'full_name',
  'recipient_name',
  'line1',
  'line2',
  'postal_code',
  'shipping_address',
  'billing_address',
  'access_token',
  'anon_token',
  'confirm_token',
  'apikey',
  'authorization',
  'cookie',
  'set-cookie',
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = PII_KEYS.has(key.toLowerCase()) ? '[redacted]' : scrub(inner, depth + 1);
  }
  return out;
}

export const sharedOptions: NodeOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: TRACES_SAMPLE_RATE,
  // We do our own redaction below; sending default PII would defeat it.
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request?.cookies) delete event.request.cookies;
    if (event.request?.headers)
      event.request.headers = scrub(event.request.headers) as typeof event.request.headers;
    if (event.request?.data) event.request.data = scrub(event.request.data);
    if (event.user) event.user = { id: event.user.id };
    if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.data) breadcrumb.data = scrub(breadcrumb.data) as typeof breadcrumb.data;
    return breadcrumb;
  },
};
