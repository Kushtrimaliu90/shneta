import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'shop',
  });
  return {
    title: t('title'),
    description: t('metaDescription'),
    // docs/05 §2 — canonical strips filter params; the filtered views are not separate pages.
    alternates: { canonical: '/shop', languages: { sq: '/shop', en: '/en/shop' } },
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
