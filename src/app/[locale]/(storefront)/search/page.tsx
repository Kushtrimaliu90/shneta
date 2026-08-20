import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { localizePath, pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { listFeaturedProducts, listProducts } from '@/features/catalog/queries';
import { parseFilters } from '@/features/catalog/filters';
import { logSearch, searchIngredients } from '@/features/search/actions';
import { getDidYouMean, listSearchRedirects } from '@/features/search/queries';
import { matchSearchRedirect } from '@/features/search/redirects';
import { SearchClickTracker } from '@/features/search/components/search-click-tracker';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** docs/05 §8 — dynamic. A results page is per-query and worth nothing cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale: resolveLocale(rawLocale), namespace: 'search' });
  const q = first(query.q);

  return {
    title: q ? t('resultsFor', { query: q }) : t('title'),
    // A search results page is a dead end for a crawler: it duplicates the shop grid and
    // multiplies into one URL per query string.
    robots: { index: false, follow: true },
  };
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/**
 * docs/05 §8 — the full search page.
 *
 * Two result groups, both of which lead somewhere real: **Products**, which reuses the shop grid so
 * ranking and cards are identical to `/shop?q=`, and **Ingredients**, which the A–Z pages back.
 *
 * Filtering and pagination are deliberately absent: `?q=` is also a filter the shop grid accepts, so
 * anyone who wants to narrow a search follows through to `/shop` rather than getting a second, subtly
 * different filter panel here.
 *
 * ── The zero-result path is the interesting one ──
 *
 * An empty results page is the most expensive thing a shop can show: the shopper has told you exactly
 * what they wanted and you have answered "no". Four things happen before that answer is given, in
 * ascending order of desperation:
 *
 *   1. **A redirect.** "transporti" is a real search and it wants the shipping page, not a product list.
 *   2. **A relaxed pass.** Strict matching requires every term; if that finds nothing, `listProducts`
 *      re-runs with any-term matching and flags the result so the banner can say so.
 *   3. **A spelling correction.** "magnezium bisglicinat" against the catalogue's own vocabulary.
 *   4. **Popular products.** Better than a blank page, and honestly labelled as a fallback rather than
 *      dressed up as results.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const q = first(query.q);

  // docs/05 §8 acceptance — an empty query redirects to the shop rather than rendering nothing.
  if (!q) redirect(localizePath('/shop', locale));

  /*
   * Before anything is searched. A query that wants a policy page should never see a product grid, and
   * the redirect table is cached, so this costs nothing per request in the overwhelmingly common case
   * where it does not match.
   */
  const destination = matchSearchRedirect(await listSearchRedirects(), q, locale);
  if (destination) redirect(destination);

  const t = await getTranslations('search');
  const filters = { ...parseFilters(query), q, locale };

  const [products, ingredients] = await Promise.all([
    listProducts(filters),
    searchIngredients(q, 24),
  ]);

  const nothing = products.items.length === 0 && ingredients.length === 0;

  // Only on the way to an empty page — a suggestion is worthless next to results, and the RPC is not
  // worth running when it will not be shown.
  const [didYouMean, popular] = nothing
    ? await Promise.all([getDidYouMean(q), listFeaturedProducts(4)])
    : [null, []];

  /*
   * Logged after the results are known, because the result count *is* the measurement. Awaited rather
   * than fired off, since the event id is what attributes a click below — and `log_search` swallows its
   * own failures, so this cannot take the page down.
   */
  const eventId = await logSearch({
    query: q,
    locale,
    source: 'results',
    resultCount: products.total,
    relaxed: products.relaxed,
    didYouMean,
  });

  const trackedItems = products.items.map((item) => ({ slug: item.slug, id: item.id }));

  return (
    <div className="container-wide py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900">
        {t('resultsFor', { query: q })}
      </h1>

      {/*
        Shown above the results, not instead of them. The relaxed pass found *something*, and hiding the
        fact that it widened the query would leave the shopper wondering why a product they did not name
        is on the page.
      */}
      {products.relaxed && products.items.length > 0 && (
        <p className="mt-3 rounded-md border border-line bg-forest-50 px-4 py-3 text-sm text-ink-900">
          {t('relaxedNotice', { query: q })}
        </p>
      )}

      {didYouMean && (
        <p className="mt-3 text-sm text-ink-900">
          {t.rich('didYouMean', {
            suggestion: (chunks) => (
              <Link
                href={`/search?q=${encodeURIComponent(didYouMean)}`}
                className="font-medium text-forest-800 underline underline-offset-4"
              >
                {chunks}
              </Link>
            ),
            query: didYouMean,
          })}
        </p>
      )}

      {nothing ? (
        <>
          <EmptyState
            icon={SearchX}
            title={t('noResults', { query: q })}
            body={t('noResultsHint')}
            className="mt-8"
            action={
              <Link href="/shop" className={buttonVariants({ size: 'sm' })}>
                {t('browseShop')}
              </Link>
            }
          />

          {popular.length > 0 && (
            <section className="mt-12">
              <h2 className="font-display text-xl font-semibold text-forest-900">
                {t('popularTitle')}
              </h2>
              <p className="mt-1 text-sm text-ink-600">{t('popularBody')}</p>
              <div className="mt-4">
                <ProductGrid
                  result={{
                    items: popular,
                    total: popular.length,
                    page: 1,
                    pageCount: 1,
                    relaxed: false,
                  }}
                  hasFilters={false}
                  clearHref="/shop"
                />
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {products.items.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold text-forest-900">
                {t('tabs.products')}{' '}
                <span className="font-ui text-sm font-normal text-ink-500" data-numeric>
                  {products.total}
                </span>
              </h2>
              <div className="mt-4">
                {/*
                  `hasFilters` is false and the clear link is unused: this page never renders the
                  grid's empty state — the `nothing` branch above owns that, because "no products
                  but three ingredients" is a result, not an empty page.
                */}
                {eventId ? (
                  <SearchClickTracker eventId={eventId} items={trackedItems}>
                    <ProductGrid result={products} hasFilters={false} clearHref="/shop" />
                  </SearchClickTracker>
                ) : (
                  <ProductGrid result={products} hasFilters={false} clearHref="/shop" />
                )}
              </div>

              {products.total > products.items.length && (
                <Link
                  href={`/shop?q=${encodeURIComponent(q)}`}
                  className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-6')}
                >
                  {/*
                    Handing the query to the shop grid rather than paginating here: that page
                    already has the filters, the facets and the pagination, and two
                    implementations of the same list is how they drift.
                  */}
                  {t('seeAll', { query: q })}
                </Link>
              )}
            </section>
          )}

          {ingredients.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold text-forest-900">
                {t('tabs.ingredients')}{' '}
                <span className="font-ui text-sm font-normal text-ink-500" data-numeric>
                  {ingredients.length}
                </span>
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {ingredients.map((ingredient) => (
                  <li key={ingredient.slug}>
                    <Link
                      href={`/ingredients/${ingredient.slug}`}
                      className="inline-flex rounded-sm border border-line bg-surface px-3 py-1.5 text-sm text-ink-900 hover:bg-forest-50"
                    >
                      {pickLocale(ingredient.name, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
