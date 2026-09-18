import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductListingPage } from '@/features/catalog/components/plp';
import type { ProductFilters } from '@/features/catalog/types';
import { getCategoryBySlug } from '@/features/catalog/queries';

/**
 * docs/05 §2 — a category page is the PLP scoped to one category. One body, two routes (owner
 * cost report, 2026-09-18): the bare `/shop/[category]` renders it unfiltered and is
 * PREBUILT (its generateStaticParams finally means something), while `/shop/[category]/f`
 * reads the query and stays dynamic. `getCategoryBySlug` is request-cached, so the metadata
 * and the body share one lookup.
 */
export async function CategoryLander({
  slug,
  locale,
  filters,
}: {
  slug: string;
  locale: Locale;
  filters: ProductFilters;
}) {
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const t = await getTranslations();
  const name = pickLocale(category.name, locale);

  return (
    <>
      <nav aria-label={t('shop.breadcrumbs')} className="container-wide pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/shop"
              className="rounded-sm underline underline-offset-4 hover:text-forest-700"
            >
              {t('shop.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {name}
          </li>
        </ol>
      </nav>

      <ProductListingPage
        filters={{ ...filters, category: [slug] }}
        basePath={`/shop/${slug}`}
        /*
         * The category is in the path, not the query. Every link on the page needs to know that:
         * without it, removing this chip rebuilt the URL it was already on. See `unscopeCategory`.
         */
        scopedCategory={slug}
        title={name}
        /* Targeting: a placement scoped to this category qualifies here and nowhere else. */
        placementCategorySlug={slug}
      />
    </>
  );
}
