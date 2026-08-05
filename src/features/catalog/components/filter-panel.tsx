import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { buildQuery, DIETARY_TAGS, hasActiveFilters } from '@/features/catalog/filters';
import type { CategoryNode, ProductFilters } from '@/features/catalog/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §2 — filters as URL state.
 *
 * Deliberately built from **links, not checkboxes with JavaScript**. Every filter is a real
 * navigation, so it works without JS, is crawlable, the back button restores state for free,
 * and the page stays a Server Component with no client bundle cost. The mobile filter sheet
 * from docs/04 §6 is a later refinement on top of this, not a prerequisite for it.
 *
 * Active filters are marked with `aria-current`, not `aria-pressed`: these are links to a
 * filtered view, and `aria-pressed` is only valid on elements with a button role — axe
 * reports it as `aria-allowed-attr` on an anchor.
 */
export async function FilterPanel({
  filters,
  basePath,
  categories,
  brands,
  goals,
}: {
  filters: ProductFilters;
  basePath: string;
  categories: CategoryNode[];
  brands: { slug: string; name: string }[];
  goals: { slug: string; name: LocalizedField }[];
}) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  /*
   * Every facet link is `rel="nofollow"`, and that is a load-bearing attribute rather than an SEO nicety.
   *
   * Each link is the current filters plus one more value, so the panel is a graph whose node count is the
   * product of every facet: 16 categories × 20 brands × 9 goals × dietary tags × sorts × pages. A crawler
   * following it walks a space with no end, and `/shop` is deliberately dynamic — "the filter
   * combinations are unbounded", as the page says — so **every one of those URLs is a live
   * `search_products` round trip that no cache can ever serve twice**.
   *
   * Measured, not theorised. Over the 5.6 days `pg_stat_statements` had been collecting, 4.8M of the
   * project's 4.9M PostgREST requests were `search_products`, and the dominant argument shapes were
   * combinations — goal+brand, goal+brand+category+tag — in proportions no human clicking around
   * produces. Four hours of database CPU, on a shop with no customers yet.
   *
   * The canonical tag does not help: it deduplicates in the index *after* the crawler has fetched the
   * page, which is exactly the cost being paid. `nofollow` is what stops the discovery. `robots.ts`
   * disallows the same URLs for crawlers that ignore it, and the metadata marks filtered views
   * `noindex` — three layers, because only the first one is free.
   */
  const href = (change: Parameters<typeof buildQuery>[1]) =>
    `${basePath}${buildQuery(filters, change)}`;

  const group = 'border-line border-b pb-5';
  const heading = 'font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase';
  const option = (active: boolean) =>
    cn(
      'flex min-h-9 items-center gap-2 rounded-sm px-2 text-sm transition-colors',
      active ? 'bg-forest-100 font-medium text-forest-900' : 'text-ink-600 hover:bg-forest-50',
    );

  return (
    <aside
      aria-label={t('shop.filters')}
      className="flex w-full flex-col gap-5 lg:w-60 lg:shrink-0"
    >
      {hasActiveFilters(filters) && (
        <Link
          href={basePath}
          className="rounded-sm text-sm text-forest-700 underline underline-offset-4"
        >
          {t('shop.clearFilters')}
        </Link>
      )}

      <div className={group}>
        <h2 className={heading}>{t('shop.categories')}</h2>
        <ul className="mt-3 flex flex-col gap-0.5">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/shop/${category.slug}`}
                className={option(filters.category?.includes(category.slug) ?? false)}
              >
                {pickLocale(category.name, locale)}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className={group}>
        <h2 className={heading}>{t('shop.brands')}</h2>
        <ul className="mt-3 flex flex-col gap-0.5">
          {brands.map((brand) => {
            const active = filters.brand?.includes(brand.slug) ?? false;
            return (
              <li key={brand.slug}>
                <Link
                  href={href({ toggle: { key: 'brand', value: brand.slug } })}
                  rel="nofollow"
                  aria-current={active ? 'true' : undefined}
                  className={option(active)}
                >
                  {brand.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={group}>
        <h2 className={heading}>{t('shop.goals')}</h2>
        <ul className="mt-3 flex flex-col gap-0.5">
          {goals.map((goal) => {
            const active = filters.goal?.includes(goal.slug) ?? false;
            return (
              <li key={goal.slug}>
                <Link
                  href={href({ toggle: { key: 'goal', value: goal.slug } })}
                  rel="nofollow"
                  aria-current={active ? 'true' : undefined}
                  className={option(active)}
                >
                  {pickLocale(goal.name, locale)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={group}>
        <h2 className={heading}>{t('shop.dietary')}</h2>
        <ul className="mt-3 flex flex-col gap-0.5">
          {DIETARY_TAGS.map((tag) => {
            const active = filters.tag?.includes(tag) ?? false;
            return (
              <li key={tag}>
                <Link
                  href={href({ toggle: { key: 'tag', value: tag } })}
                  rel="nofollow"
                  aria-current={active ? 'true' : undefined}
                  className={option(active)}
                >
                  {t(`shop.tags.${tag}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h2 className={heading}>{t('shop.availability')}</h2>
        <ul className="mt-3 flex flex-col gap-0.5">
          <li>
            <Link
              href={href({ inStock: filters.inStock ? undefined : true })}
              rel="nofollow"
              aria-current={filters.inStock ? 'true' : undefined}
              className={option(filters.inStock ?? false)}
            >
              {t('shop.inStockOnly')}
            </Link>
          </li>
          <li>
            <Link
              href={href({ onSale: filters.onSale ? undefined : true })}
              rel="nofollow"
              aria-current={filters.onSale ? 'true' : undefined}
              className={option(filters.onSale ?? false)}
            >
              {t('shop.onSaleOnly')}
            </Link>
          </li>
        </ul>
      </div>
    </aside>
  );
}
