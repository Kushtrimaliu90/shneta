import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'shop',
  });

  /*
   * A filtered view is `noindex`, and the unfiltered `/shop` is not.
   *
   * The canonical below has always said the filtered views are the same page, but a canonical is a
   * hint applied *after* the crawler has fetched the URL — which is the cost, not the indexing. So this
   * is the third of three layers: `rel="nofollow"` on the facet links stops the walk,
   * `robots.ts` disallows the URLs for crawlers that ignore it, and this drops anything already
   * indexed back out.
   *
   * Keyed on there being any search param at all rather than on a list of filter names, so a facet
   * added later is covered without anybody remembering this file.
   */
  const filtered = Object.keys(await searchParams).length > 0;

  return {
    title: t('title'),
    description: t('metaDescription'),
    // docs/05 §2 — canonical strips filter params; the filtered views are not separate pages.
    alternates: { canonical: '/shop', languages: { sq: '/shop', en: '/en/shop' } },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * docs/05 §2 — the full product listing.
 *
 * Dynamic rather than ISR because the filter combinations are unbounded, which is what
 * docs/02 §5 specifies ("dynamic when filter/sort params present"). The underlying queries
 * are a single RPC with the count as a window function, so a filtered page is one round trip.
 */
export default async function ShopPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const filters = parseFilters(await searchParams);
  const t = await getTranslations('shop');

  return <ProductListingPage filters={filters} basePath="/shop" title={t('title')} />;
}
