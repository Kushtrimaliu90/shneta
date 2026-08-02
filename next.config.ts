import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Supabase Storage serves product/content imagery. The host is env-derived so that local,
 * staging and prod each allow only their own bucket origin (docs/10 §5).
 */
function supabaseImagePattern(): { protocol: 'https' | 'http'; hostname: string; port: string }[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return [
      {
        protocol: url.protocol === 'http:' ? 'http' : 'https',
        hostname: url.hostname,
        port: url.port,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * docs/10 §5 — the content security policy, in two versions.
 *
 * **Why two.** The strict version cannot be enforced. Next.js streams its RSC payload and
 * hydration data through inline `<script>` tags, so `script-src 'self'` blocks them: the page
 * renders and never hydrates. Measured, not assumed — with the strict policy enforced, every one
 * of ten sampled pages logged a run of "Executing inline script violates ... 'script-src 'self''"
 * and no page became interactive (docs/13 §Q3).
 *
 * The two escapes both cost more than they save:
 *
 *   · A **nonce** requires generating one per request in middleware, which makes every page
 *     dynamic — undoing the static rendering M11 exists to restore (§Q1). Trading the Full Route
 *     Cache for a directive is the wrong side of that bargain.
 *   · **Hashes** cannot work: the inline payload differs per page and per build.
 *
 * So the enforced policy allows inline script and everything else stays strict. That is worth
 * having on its own — it still blocks third-party script origins, `eval`, plugin content,
 * base-tag injection, framing, and form posts to another origin, which is most of what an
 * injected `<script src>` or a clickjacking attempt needs.
 *
 * The strict version ships alongside as **report-only**, so violations stay visible and the day
 * Next supports nonces without forcing dynamic rendering, the reports will already be clean.
 */
const CSP_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // docs/13 §F3 — Next injects inline styles; the nonce alternative forces dynamic rendering.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.supabase.co https://*.supabase.in",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
];

const DEV_EVAL = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';

/** Enforced. Permissive only where Next leaves no choice. */
const CSP_ENFORCED = [...CSP_BASE, `script-src 'self' 'unsafe-inline'${DEV_EVAL}`].join('; ');

/** Report-only. What we would enforce if inline script were avoidable. */
const CSP_STRICT = [...CSP_BASE, `script-src 'self'${DEV_EVAL}`].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  /*
   * docs/10 §5 asks for report-only in week one, then enforcement. `CSP_ENFORCE` is that switch,
   * so the promotion is a redeploy rather than a code change and the rollback is unsetting it.
   *
   * Before the flip both headers are report-only, which is the point of week one: the strict one
   * will report inline-script violations by design, and the enforced one reporting *anything* is
   * the signal that something real would break.
   */
  {
    key:
      process.env.CSP_ENFORCE === 'true'
        ? 'Content-Security-Policy'
        : 'Content-Security-Policy-Report-Only',
    value: CSP_ENFORCED,
  },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_STRICT },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: supabaseImagePattern(),
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

/**
 * docs/02 §10 — Sentry wraps the config last so it can instrument the built output.
 *
 * Source maps are uploaded only when both a DSN and an auth token are present, so a build
 * without Sentry credentials succeeds unchanged. `silent` keeps CI logs clean;
 * `disableLogger` strips Sentry's own debug statements from the client bundle, which
 * matters against the 170 kB budget in docs/09 §3.
 */
const sentryEnabled = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Strips Sentry's own debug logging from the client bundle — it matters against the
  // 170 kB budget in docs/09 §3.
  webpack: { treeshake: { removeDebugLogging: true } },
  sourcemaps: {
    disable: !sentryEnabled || !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  // Proxies Sentry's ingest through our own origin so it survives ad blockers and needs no
  // third-party entry in the CSP (docs/10 §5).
  tunnelRoute: '/monitoring',
  telemetry: false,
});
