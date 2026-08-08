import type { MetadataRoute } from 'next';
import { clientEnv } from '@/lib/env.client';
import { serverEnv } from '@/lib/env.server';

/** docs/08 §4 — allow everything except the private and non-indexable surfaces. */
export default function robots(): MetadataRoute.Robots {
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  /*
   * Pre-launch, nothing is crawlable at all.
   *
   * Crawler traffic was the whole of the 8 Aug 2026 spend that paused the deployment, and the pages
   * being crawled are 48 of 63 products showing a placeholder instead of a photograph plus three
   * legal documents still carrying `[BIZNESI: plotëso]`. Paying to have that indexed is worse than
   * paying nothing to have it ignored.
   *
   * No `sitemap` line either: advertising 140 URLs while refusing to serve them is a mixed signal,
   * and the sitemap is the thing that invites the deep crawl in the first place.
   */
  if (serverEnv.SEO_INDEXING !== 'on') {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

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
          /*
           * Faceted listing URLs.
           *
           * The filter panel links to the current filters plus one more value, so the reachable set is
           * the product of every facet — categories × brands × goals × tags × sorts × pages — and
           * `/shop` is dynamic, so each one is a live query that no cache serves twice. Measured over
           * 5.6 days: 4.8M of 4.9M PostgREST requests were the listing query, four hours of database CPU,
           * on a shop with no customers.
           *
           * The links carry `rel="nofollow"`, which is what actually stops the walk; this is the second
           * layer, for crawlers that ignore it. The unparameterised pages stay fully crawlable — `/shop`,
           * `/shop/[category]`, `/brands/[slug]`, `/goals/[slug]` are the pages worth indexing, and each
           * filtered view already canonicalises to one of them.
           *
           * Wildcards in `Disallow` are not in the original robots standard but are honoured by Google,
           * Bing and Yandex, which is who this is for.
           */
          '/shop?*',
          '/en/shop?*',
          '/*?brand=',
          '/*?goal=',
          '/*?tag=',
          '/*?onSale=',
          '/*?inStock=',
          '/*?minPrice=',
          '/*?maxPrice=',
          '/*?minRating=',
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
