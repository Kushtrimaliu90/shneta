import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ActiveFilters } from '@/features/catalog/components/active-filters';
import { FilterPanel } from '@/features/catalog/components/filter-panel';
import { FilterShell } from '@/features/catalog/components/filter-shell';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import {
  buildQuery,
  hasActiveFilters,
  unscopeCategory,
  SHOP_PATH,
  SORT_OPTIONS,
} from '@/features/catalog/filters';
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
  eyebrow,
  media,
  banner,
  intro,
  compact = false,
  placementCategorySlug,
  placementBrandSlug,
  scopedCategory,
}: {
  filters: ProductFilters;
  basePath: string;
  title: string;
  /**
   * The identity slot (docs/05 §4–§5): brand and goal pages are the PLP scoped to one thing,
   * and that thing has a face — a tagline, a logo, sometimes a banner. Slots on the shared
   * header rather than a parallel header per page, so the h1, count and intro keep one layout
   * and a scoped page only supplies what it has.
   */
  /** One line of context directly above the h1 — a goal's tagline, rendered as an eyebrow. */
  eyebrow?: string;
  /** A compact visual beside the h1 — a brand's logo tile, a goal's image. Sized by the caller. */
  media?: ReactNode;
  /** A full-width band above the header — a brand's banner. Height discipline is the caller's. */
  banner?: ReactNode;
  intro?: LocalizedField;
  /**
   * Folds the h1 into the toolbar row instead of giving it its own header band (owner,
   * 2026-09-01). For the bare `/shop` route ONLY: its title repeats what the nav's active pill
   * already says, and at display scale that cost ~120px on the highest-traffic listing page —
   * measured at 1080p, the first product row started ~700px down. The scoped landings
   * (category, brand, goal) arrive from search where the h1 IS the page's identity, so they
   * keep the display header and must not pass this. Ignores `eyebrow`/`media`/`intro`.
   */
  compact?: boolean;
  /**
   * The category carried by the URL **path** rather than the query, on `/shop/[category]`.
   *
   * Every link on the page is built from `queryFilters` below, which excludes it — see
   * `unscopeCategory` for the two bugs that came of serialising a path segment into a query string.
   */
  scopedCategory?: string;
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

  /*
   * `filters` still drives the *query* to the database — the scoped category is a real filter and the
   * listing must stay narrowed by it. `queryFilters` drives every *link*, because the path already
   * carries it and repeating it in the query string is what produced
   * `/shop/vitaminat?category=vitaminat`.
   */
  const queryFilters = unscopeCategory(filters, scopedCategory);

  const sortHref = (sort: (typeof SORT_OPTIONS)[number]) =>
    `${basePath}${buildQuery(queryFilters, { sort })}`;
  const pageHref = (page: number) => `${basePath}${buildQuery(queryFilters, { page })}`;
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

  /*
   * The wide tier: this page is a grid with a facet column, which is exactly the shape that should
   * show more when the screen has more room. Sixty-nine products presented four-at-a-time on a 2560
   * screen read like a small shop.
   */
  return (
    <div className="container-wide py-8 lg:py-12">
      {banner && <div className="mb-6 lg:mb-8">{banner}</div>}

      {!compact && (
        <header className="mb-8">
          {eyebrow && <p className="mb-2 eyebrow">{eyebrow}</p>}
          <div className={cn(media && 'flex items-center gap-4 lg:gap-5')}>
            {media}
            <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
              {title}
            </h1>
          </div>
          {/*
            Phone-only. From `sm` up the count sits at the right end of the toolbar row below, where
            it reads as a property of the controls that change it; a phone's toolbar is already full
            with the sort rail, so there the count keeps its old spot under the h1.
          */}
          <p className="mt-2 text-sm text-ink-500 sm:hidden" data-numeric>
            {t('shop.productCount', { count: result.total })}
          </p>
          {introText && <p className="mt-4 max-w-2xl text-ink-600">{introText}</p>}
        </header>
      )}

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
            scopedCategory={scopedCategory}
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

            The rail hides its scrollbar (`no-scrollbar`, same budget argument as `category-row.tsx`)
            and fades at its trailing edge instead (`rail-fade-x`), so an option that continues past
            the fold dissolves rather than being cut mid-glyph. `flex-1` makes the rail claim the
            whole slack between itself and the count, so the fade sits at the column edge — over
            empty space when everything fits, over the overflowing option when it does not.

            The result count closes the row on the right from `sm` up (phones keep it under the h1),
            so the toolbar has both ends: controls left, consequence right.

            In `compact` mode the h1 joins this row too — small, first, ahead of the controls — and
            the row is allowed to wrap so a phone gets "title + count" on the first line with the
            rail beneath, while `sm` and up keep the single line the mockup chose: title, sort,
            count. The heading element itself never changes, only its stage.

            The Filters trigger is not here — it lives inside `FilterShell`, which is the flex
            container's first child and therefore sits directly above this row on mobile. Hoisting it
            into the toolbar would mean a portal or context to reach across the two columns, for one
            row of vertical space.
          */}
          <div
            className={cn(
              'mb-4 flex items-center gap-2 border-b border-line pb-4',
              compact && 'flex-wrap gap-x-3 gap-y-2.5',
            )}
          >
            {compact && (
              <h1 className="shrink-0 font-display text-xl font-semibold text-forest-900 lg:text-2xl">
                {title}
              </h1>
            )}
            {/*
              Outside the masked scroller: a label is not an option, and inside the rail its
              first glyphs sat in the mask's ramp (see `rail-fade-x` in globals.css). Out here
              it is always fully opaque and never scrolls away.
            */}
            <span className="hidden shrink-0 eyebrow sm:inline">{t('shop.sortBy')}</span>
            <div
              className={cn(
                'no-scrollbar flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto rail-fade-x pe-6',
                /* Phones: the rail takes its own full-width line under the title. */
                compact && 'order-last w-full basis-full sm:order-none sm:w-auto sm:basis-auto',
              )}
            >
              {SORT_OPTIONS.map((sort) => (
                <Link
                  key={sort}
                  href={sortHref(sort)}
                  aria-current={sort === activeSort ? 'true' : undefined}
                  /*
                   * The two price options are distinguished only by an arrow glyph, and a screen reader
                   * may announce "↑" as nothing at all — leaving two links both named "Çmimi", which is
                   * indistinguishable. So they get their direction in words.
                   *
                   * It also fixes the ambiguity permanently. The arrows used to encode the *sort*
                   * direction (ascending, descending), which is why "Çmimi ↑" showed the cheapest
                   * products and was reported as backwards. They now encode the *price*, low or high,
                   * and the accessible name says which so nobody has to infer it from a symbol.
                   */
                  aria-label={
                    sort === 'price_asc' || sort === 'price_desc'
                      ? t(`shop.sortAria.${sort}`)
                      : undefined
                  }
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

            {/*
              In compact mode there is no header for the phone count line to live under, so the
              count is visible at every width here — on a phone it closes the title line.
            */}
            <p
              className={cn(
                'ml-auto shrink-0 text-sm text-ink-500',
                compact ? 'block' : 'hidden sm:block',
              )}
              data-numeric
            >
              {t('shop.productCount', { count: result.total })}
            </p>
          </div>

          <ActiveFilters
            filters={filters}
            basePath={basePath}
            scopedCategory={scopedCategory}
            categories={categories}
            brands={brands}
            goals={goals}
          />

          <ProductGrid
            /*
              The rail-aware ladder. This grid sits in `content − 240px rail − 48px gap`, so it
              cannot share the full-width ladder without either ballooning the cards or shrinking
              them: four columns of a 928px track at 1280 is 214px a card, where four columns of the
              full 1216px track is 292px.

              Tuned so a card stays between 212 and 280px at every width from 1024 to 2560 — 3 / 4 / 5
              columns rather than the single frozen 4 it used to be.
            */
            columns="lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5"
            result={result}
            hasFilters={hasActiveFilters(filters)}
            /*
             * "Clear filters" from the empty state has to clear the category too, and on a scoped
             * page that lives in the path — `basePath` would leave the visitor on the same empty
             * category, which is the state they are trying to escape.
             */
            clearHref={scopedCategory ? SHOP_PATH : basePath}
          />

          {/*
            docs/05 §2 asks for "Load more" plus crawlable `?page=` links. Real links are the
            floor: they work without JavaScript and search engines can follow them. A
            client-side "load more" is an enhancement layered on later.
          */}
          {/*
            The Albanian labels used to be "Para" and "Pas" — literally *before* and *after*, which as
            standalone buttons read as backwards and forwards respectively. "Pas" was reported as
            looking like a back button, and it did.

            They are now "E mëparshme" and "Tjetra", feminine to agree with `faqja`, which is the same
            idiom the carousel already uses ("Sllajdi tjetër"). The fuller "Faqja tjetër" was tried
            first and wrapped this control to three rows on a 390 px phone: the noun is already on
            screen in the counter between the two buttons, and the nav is labelled "Faqet", so
            repeating it cost height and bought nothing.

            `flex-wrap` stays as the safety net, since these are words rather than arrows.
          */}
          {/*
            Both slots render on every page. When they were conditional, "Tjetra" stood first on
            page 1 and second from page 2 on — the button a shopper is mid-way through paging with
            teleported under their pointer — and the last page trailed off with nothing where the
            forward control had been. At an edge the slot is a non-interactive span in the
            decorative/disabled tokens (`border-line`, `ink-400` — docs/13 §C keeps `ink-400` for
            exactly this), `aria-hidden` because the counter beside it already tells a screen
            reader where they are; announcing a dead "Tjetra" would only invite a press that does
            nothing. Centred under the grid: anchored left it read as part of the facet column.
          */}
          {result.pageCount > 1 && (
            <nav
              aria-label={t('shop.pagination')}
              className="mt-10 flex flex-wrap items-center justify-center gap-2"
            >
              {result.page > 1 ? (
                <Link
                  href={pageHref(result.page - 1)}
                  rel="prev"
                  className="rounded-md border border-line-strong px-3.5 py-2 text-sm hover:bg-forest-50"
                >
                  {t('shop.previous')}
                </Link>
              ) : (
                <span
                  aria-hidden="true"
                  className="rounded-md border border-line px-3.5 py-2 text-sm text-ink-400"
                >
                  {t('shop.previous')}
                </span>
              )}
              <span className="text-sm text-ink-600" data-numeric>
                {t('shop.pageOf', { page: result.page, total: result.pageCount })}
              </span>
              {result.page < result.pageCount ? (
                <Link
                  href={pageHref(result.page + 1)}
                  rel="next"
                  className="rounded-md border border-line-strong px-3.5 py-2 text-sm hover:bg-forest-50"
                >
                  {t('shop.next')}
                </Link>
              ) : (
                <span
                  aria-hidden="true"
                  className="rounded-md border border-line px-3.5 py-2 text-sm text-ink-400"
                >
                  {t('shop.next')}
                </span>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
