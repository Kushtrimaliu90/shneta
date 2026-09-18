import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';

/**
 * Explicitly dynamic. Reading searchParams already forces this, but the static `f` segment
 * gave the build an empty-query shell to prerender optimistically — declaring intent keeps a
 * future refactor from ever serving one cached page for every filter combination.
 */
export const dynamic = 'force-dynamic';
type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'shop',
  });

  /*
   * Every view here is a filtered view, and a filtered view is `noindex` by three-layer policy
   * (rel="nofollow" facet links, robots disallow, and this) — moved wholesale from /shop when
   * the split landed (owner cost report, 2026-09-18). The canonical says what it always said:
   * the filtered views are not separate pages.
   */
  return {
    title: t('title'),
    description: t('metaDescription'),
    robots: { index: false, follow: true },
    alternates: { canonical: '/shop', languages: { sq: '/shop', en: '/en/shop' } },
  };
}

/**
 * docs/05 §2 — the listing's FILTERED views: the dynamic sibling that reads searchParams so
 * `/shop` itself can stay prerendered (owner cost report, 2026-09-18). The filter combinations
 * are unbounded, which is what docs/02 §5 means by "dynamic when filter/sort params present" —
 * this route is that clause, made into its own segment.
 */
export default async function ShopFilteredPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const filters = parseFilters(await searchParams);
  const t = await getTranslations('shop');

  return <ProductListingPage filters={filters} basePath="/shop" title={t('title')} compact />;
}
