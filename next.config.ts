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
 * docs/10 §5. `style-src` keeps 'unsafe-inline' deliberately: Next.js injects inline styles and
 * the nonce alternative forces dynamic rendering, which would defeat the ISR strategy in
 * docs/02 §5. See docs/13 §F3.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://*.supabase.co https://*.supabase.in",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

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
  // Report-only for the first week per docs/10 §5, then promoted to Content-Security-Policy.
  { key: 'Content-Security-Policy-Report-Only', value: CSP },
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
