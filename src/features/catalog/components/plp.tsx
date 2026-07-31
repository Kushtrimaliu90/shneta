import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { FilterPanel } from '@/features/catalog/components/filter-panel';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { buildQuery, hasActiveFilters, SORT_OPTIONS } from '@/features/catalog/filters';
import { getCategoryTree, listBrands, listGoals, listProducts } from '@/features/catalog/queries';
import type { ProductFilters } from '@/features/catalog/types';
import { cn } from '@/lib/utils';

/**
 * The shared PLP body (docs/05 §2). `/shop`, `/shop/[category]`, brand and goal pages all
 * render this, so filtering, sorting and pagination behave identically everywhere — the
 * spec's "reuses §2 machinery" made concrete rather than reimplemented four times.
 */
export async function ProductListingPage({
  filters,
  basePath,
  title,
  intro,
}: {
  filters: ProductFilters;
  basePath: string;
  title: string;
  intro?: LocalizedField;
}) {
  const [result, categories, brands, goals] = await Promise.all([
    listProducts(filters),
    getCategoryTree(),
    listBrands(),
    listGoals(),
  ]);

  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const introText = intro ? pickLocale(intro, locale) : '';

  const sortHref = (sort: (typeof SORT_OPTIONS)[number]) =>
    `${basePath}${buildQuery(filters, { sort })}`;
  const pageHref = (page: number) => `${basePath}${buildQuery(filters, { page })}`;
  const activeSort = filters.sort ?? 'relevance';

  return (
    <div className="container-page py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-500" data-numeric>
          {t('shop.productCount', { count: result.total })}
        </p>
        {introText && <p className="mt-4 max-w-2xl text-ink-600">{introText}</p>}
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        <FilterPanel
          filters={filters}
          basePath={basePath}
          categories={categories}
          brands={brands}
          goals={goals}
        />

        <div className="min-w-0 flex-1">
          <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-4">
            <span className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
              {t('shop.sortBy')}
            </span>
            {SORT_OPTIONS.map((sort) => (
              <Link
                key={sort}
                href={sortHref(sort)}
                aria-current={sort === activeSort ? 'true' : undefined}
                className={cn(
                  'rounded-sm px-2.5 py-1.5 text-sm transition-colors',
                  sort === activeSort
                    ? 'bg-forest-100 font-medium text-forest-900'
                    : 'text-ink-600 hover:bg-forest-50',
                )}
              >
                {t(`shop.sort.${sort}`)}
              </Link>
            ))}
          </div>

          <ProductGrid
            result={result}
            hasFilters={hasActiveFilters(filters)}
            clearHref={basePath}
          />

          {/*
            docs/05 §2 asks for "Load more" plus crawlable `?page=` links. Real links are the
            floor: they work without JavaScript and search engines can follow them. A
            client-side "load more" is an enhancement layered on later.
          */}
          {result.pageCount > 1 && (
            <nav aria-label={t('shop.pagination')} className="mt-10 flex items-center gap-2">
              {result.page > 1 && (
                <Link
                  href={pageHref(result.page - 1)}
                  rel="prev"
                  className="rounded-md border border-line-strong px-3.5 py-2 text-sm hover:bg-forest-50"
                >
                  {t('shop.previous')}
                </Link>
              )}
              <span className="text-sm text-ink-600" data-numeric>
                {t('shop.pageOf', { page: result.page, total: result.pageCount })}
              </span>
              {result.page < result.pageCount && (
                <Link
                  href={pageHref(result.page + 1)}
                  rel="next"
                  className="rounded-md border border-line-strong px-3.5 py-2 text-sm hover:bg-forest-50"
                >
                  {t('shop.next')}
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
