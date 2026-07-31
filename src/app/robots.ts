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
          '/finder',
          '/en/search',
          '/en/compare',
          '/en/finder',
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
