import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { listProducts } from '@/features/catalog/queries';
import { parseFilters } from '@/features/catalog/filters';
import { searchIngredients } from '@/features/search/actions';
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
 * Two tabs, both of which lead somewhere real: **Products**, which reuses the shop grid so
 * ranking and cards are identical to `/shop?q=`, and **Ingredients**, which the A–Z pages back.
 *
 * The spec's third tab is Articles. `/knowledge/[slug]` arrives with M8, so an article result
 * today would be a link to a 404 — the same "surface with no destination" rule that kept
 * lab-report uploads out of M6 (docs/13 §L4). The tab appears when the pages do.
 *
 * Filtering and pagination are deliberately absent from this page: `?q=` is also a filter the
 * shop grid accepts, so anyone who wants to narrow a search follows a product result into
 * `/shop` rather than getting a second, subtly different filter panel here.
 */
export default async function SearchPage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const q = first(query.q);

  // docs/05 §8 acceptance — an empty query redirects to the shop rather than rendering nothing.
  if (!q) redirect(localizePath('/shop', locale));

  const t = await getTranslations('search');
  const filters = { ...parseFilters(query), q };

  const [products, ingredients] = await Promise.all([
    listProducts(filters),
    searchIngredients(q, 24),
  ]);

  const nothing = products.items.length === 0 && ingredients.length === 0;

  return (
    <div className="container-page py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-carbon-900">
        {t('resultsFor', { query: q })}
      </h1>

      {nothing ? (
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
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {products.items.length > 0 && (
            <section>
              <h2 className="font-display text-xl font-semibold text-carbon-900">
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
                <ProductGrid result={products} hasFilters={false} clearHref="/shop" />
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
              <h2 className="font-display text-xl font-semibold text-carbon-900">
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
                      className="inline-flex rounded-sm border border-line bg-surface px-3 py-1.5 text-sm text-ink-900 hover:bg-carbon-50"
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
