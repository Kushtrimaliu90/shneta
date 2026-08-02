import type { MetadataRoute } from 'next';
import { clientEnv } from '@/lib/env.client';

/** docs/08 §4 — allow everything except the private and non-indexable surfaces. */
export default function robots(): MetadataRoute.Robots {
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/account',
          '/checkout',
          '/cart',
          '/api',
          '/en/account',
          '/en/checkout',
          '/en/cart',
          // Not indexed per docs/08 §4: query-driven, per-user result surfaces.
          '/search',
          '/compare',
          '/en/search',
          '/en/compare',
          // docs/15 §1 — the generator is a form, and `/p/` is one person's protocol behind a
          // capability URL. Neither belongs in an index.
          '/biohack',
          '/en/biohack',
          '/p/',
          '/en/p/',
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
