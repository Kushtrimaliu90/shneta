import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters } from '@/features/catalog/filters';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — the catalogue tier. */
// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'shop',
  });

  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: { canonical: '/shop', languages: { sq: '/shop', en: '/en/shop' } },
  };
}

/**
 * docs/05 §2 — the full product listing, unfiltered and PRERENDERED (owner cost report,
 * 2026-09-18). This page deliberately reads no searchParams: the read is what opted the
 * highest-traffic listing route out of the static tier, so every visit — and every viewport
 * prefetch of the header's Shop link — was a billed dynamic render. Filtered and sorted views
 * live at the `/shop/f` sibling; every filter link on the page targets it via `filteredHref`,
 * and the middleware redirects legacy `?sort=`-style URLs across. The noindex logic for
 * filtered views moved to the sibling wholesale.
 */
export default async function ShopPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('shop');

  /*
   * `compact`: /shop is the one listing whose title only repeats the nav's active pill, so the
   * h1 folds into the toolbar row instead of spending a display-scale band on it (owner,
   * 2026-09-01 — see the prop's comment in plp.tsx). Category, brand and goal pages keep their
   * full identity headers.
   */
  return (
    <ProductListingPage filters={parseFilters({})} basePath="/shop" title={t('title')} compact />
  );
}
