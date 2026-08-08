import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ActiveFilters } from '@/features/catalog/components/active-filters';
import { FilterPanel } from '@/features/catalog/components/filter-panel';
import { FilterShell } from '@/features/catalog/components/filter-shell';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { buildQuery, hasActiveFilters, SORT_OPTIONS } from '@/features/catalog/filters';
import { getCategoryTree, listBrands, listGoals, listProducts } from '@/features/catalog/queries';
import type { ProductFilters } from '@/features/catalog/types';
import { PlacementSlot } from '@/features/placements/components/placement-slot';
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
  placementCategorySlug,
  placementBrandSlug,
}: {
  filters: ProductFilters;
  basePath: string;
  title: string;
  intro?: LocalizedField;
  /** Targeting for the sponsored slot. A category page passes its slug; /shop passes neither. */
  placementCategorySlug?: string | null;
  placementBrandSlug?: string | null;
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

  /*
   * How many facets are on, for the badge on the mobile trigger.
   *
   * Counted from the filters rather than from the chips so the number is right even when a slug no
   * longer resolves to a name — a brand deactivated while somebody had it in a bookmarked URL still
   * counts as a filter that is hiding products from them.
   */
  const activeCount =
    (filters.category?.length ?? 0) +
    (filters.brand?.length ?? 0) +
    (filters.goal?.length ?? 0) +
    (filters.tag?.length ?? 0) +
    (filters.inStock ? 1 : 0) +
    (filters.onSale ? 1 : 0);

  return (
    <div className="container-page py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-500" data-numeric>
          {t('shop.productCount', { count: result.total })}
        </p>
        {introText && <p className="mt-4 max-w-2xl text-ink-600">{introText}</p>}
      </header>

      {/*
        The sponsored slot, between the title and the filter+grid area.

        Here rather than above the title because the page has to say what it is before it says who
        paid to be on it, and below the grid it would be worth nothing to an advertiser. It renders
        nothing at all when no placement qualifies — see `PlacementSlot` for the fallback order —
        so the common case costs no height.
      */}
      <PlacementSlot categorySlug={placementCategorySlug} brandSlug={placementBrandSlug} />

      <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
        {/*
          One panel, two presentations. `FilterShell` is a static sidebar at `lg` and a full-screen
          sheet below it — see that file for why this is not two components rendering the same 51 links.
        */}
        <FilterShell activeCount={activeCount} resultCount={result.total}>
          <FilterPanel
            filters={filters}
            basePath={basePath}
            categories={categories}
            brands={brands}
            goals={goals}
          />
        </FilterShell>

        <div className="min-w-0 flex-1">
          {/*
            The toolbar. On a phone this is the whole control surface — trigger on the left, sort
            scrolling horizontally beside it — and it is what lets the grid start at the top of the
            column instead of below 51 links.

            `flex-nowrap` with `overflow-x-auto` rather than `flex-wrap`: five sort options wrapped to
            three lines on a 390 px screen, which is the same problem in miniature. A single row that
            scrolls keeps the vertical budget for products.

            The Filters trigger is not here — it lives inside `FilterShell`, which is the flex
            container's first child and therefore sits directly above this row on mobile. Hoisting it
            into the toolbar would mean a portal or context to reach across the two columns, for one
            row of vertical space.
          */}
          <div className="mb-4 flex items-center gap-2 border-b border-line pb-4">
            <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
              <span className="hidden shrink-0 font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase sm:inline">
                {t('shop.sortBy')}
              </span>
              {SORT_OPTIONS.map((sort) => (
                <Link
                  key={sort}
                  href={sortHref(sort)}
                  aria-current={sort === activeSort ? 'true' : undefined}
                  className={cn(
                    'min-h-9 shrink-0 rounded-sm px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors',
                    sort === activeSort
                      ? 'bg-forest-100 font-medium text-forest-900'
                      : 'text-ink-600 hover:bg-forest-50',
                  )}
                >
                  {t(`shop.sort.${sort}`)}
                </Link>
              ))}
            </div>
          </div>

          <ActiveFilters
            filters={filters}
            basePath={basePath}
            categories={categories}
            brands={brands}
            goals={goals}
          />

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
