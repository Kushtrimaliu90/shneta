import type { MetadataRoute } from 'next';
import { clientEnv } from '@/lib/env.client';
import { createPublicClient } from '@/lib/supabase/public';
import { logger } from '@/lib/logger';

/**
 * docs/08 §4 — the sitemap, with hreflang alternates for sq (unprefixed) and en (`/en`).
 *
 * `robots.txt` advertises this path, so a missing sitemap is a Search Console error from
 * the first crawl. Excluded per docs/08 §4: `/search`, `/compare`, `/finder`, `/account`,
 * `/checkout`, `/cart`, `/admin`, `/api` — query-driven or private surfaces.
 *
 * Catalog and content entries are read from the database. If that read fails the sitemap
 * still serves the static routes rather than returning nothing: a partial sitemap is a
 * far better failure than a build break or an empty file that de-indexes the site.
 */
// Literal, not `ISR_REVALIDATE_SECONDS`: Next statically analyses segment config and
// rejects an imported identifier. Keep in sync with lib/constants.ts.
export const revalidate = 300;

const ORIGIN = clientEnv.NEXT_PUBLIC_SITE_URL;

/** sq lives at the bare path, en under /en — so every URL is a pair (docs/08 §1). */
function entry(
  path: string,
  options: {
    lastModified?: Date;
    changeFrequency?: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority?: number;
  } = {},
): MetadataRoute.Sitemap[number] {
  const clean = path === '/' ? '' : path;
  return {
    url: `${ORIGIN}${clean || '/'}`,
    lastModified: options.lastModified ?? new Date(),
    changeFrequency: options.changeFrequency ?? 'weekly',
    priority: options.priority ?? 0.5,
    alternates: {
      languages: {
        sq: `${ORIGIN}${clean || '/'}`,
        en: `${ORIGIN}/en${clean}`,
      },
    },
  };
}

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  entry('/', { changeFrequency: 'daily', priority: 1 }),
  entry('/shop', { changeFrequency: 'daily', priority: 0.9 }),
  entry('/goals', { priority: 0.8 }),
  entry('/ingredients', { priority: 0.7 }),
  entry('/brands', { priority: 0.7 }),
  entry('/knowledge', { changeFrequency: 'daily', priority: 0.8 }),
  entry('/offers', { changeFrequency: 'daily', priority: 0.7 }),
  /*
   * The finder shipped in M10 and was missed here — a page linked from the footer since M0 and
   * invisible to search for a milestone. Found by writing the sitemap assertion in
   * `e2e/compliance.spec.ts` rather than by anyone reading this list.
   *
   * Weekly rather than daily: the quiz itself does not change, only what it recommends.
   */
  entry('/finder', { changeFrequency: 'monthly', priority: 0.6 }),
  entry('/about', { changeFrequency: 'monthly', priority: 0.4 }),
  entry('/contact', { changeFrequency: 'monthly', priority: 0.4 }),
  entry('/faq', { changeFrequency: 'monthly', priority: 0.5 }),
  entry('/order-lookup', { changeFrequency: 'yearly', priority: 0.3 }),
  entry('/legal/terms', { changeFrequency: 'yearly', priority: 0.2 }),
  entry('/legal/privacy', { changeFrequency: 'yearly', priority: 0.2 }),
  entry('/legal/shipping-returns', { changeFrequency: 'yearly', priority: 0.3 }),
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dynamicRoutes: MetadataRoute.Sitemap = [];

  try {
    const supabase = createPublicClient();

    // RLS already restricts these to published/active rows, so no status filter is needed
    // here — the policy is the filter, and duplicating it would let the two drift.
    const [categories, brands, goals, ingredients, articles, products] = await Promise.all([
      supabase.from('categories').select('slug, updated_at'),
      supabase.from('brands').select('slug, updated_at'),
      supabase.from('health_goals').select('slug, updated_at'),
      supabase.from('ingredients').select('slug, updated_at'),
      supabase.from('articles').select('slug, updated_at, published_at'),
      supabase.from('products').select('slug, updated_at'),
    ]);

    const push = (
      rows: { slug: string; updated_at: string }[] | null,
      prefix: string,
      priority: number,
    ) => {
      for (const row of rows ?? []) {
        dynamicRoutes.push(
          entry(`${prefix}/${row.slug}`, { lastModified: new Date(row.updated_at), priority }),
        );
      }
    };

    push(categories.data, '/shop', 0.8);
    push(brands.data, '/brands', 0.6);
    push(goals.data, '/goals', 0.8);
    push(ingredients.data, '/ingredients', 0.6);
    push(articles.data, '/knowledge', 0.7);
    push(products.data, '/product', 0.9);
  } catch (error) {
    logger.warn('Sitemap could not read the catalog; serving static routes only', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  return [...STATIC_ROUTES, ...dynamicRoutes];
}
