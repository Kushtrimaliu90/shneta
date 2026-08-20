import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getBrandBySlug, listBrands } from '@/features/catalog/queries';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

/** docs/02 §5 — all brands are prebuilt. */
export async function generateStaticParams() {
  const brands = await listBrands();
  return brands.map((brand) => ({ slug: brand.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const brand = await getBrandBySlug(slug);
  if (!brand) return {};

  return {
    title: brand.name,
    description: pickLocale(brand.description, locale) || undefined,
    alternates: {
      canonical: `/brands/${slug}`,
      languages: { sq: `/brands/${slug}`, en: `/en/brands/${slug}` },
    },
  };
}

/**
 * docs/05 §4 — a brand page is the PLP scoped to that brand, which is what the spec means by
 * "reuses §2 machinery". Sorting and the other filters compose with the brand scope for free.
 */
export default async function BrandPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const filters = { ...parseFilters(await searchParams), brand: [slug] };
  const t = await getTranslations();

  return (
    <>
      <nav aria-label={t('shop.breadcrumbs')} className="container-wide pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/brands"
              className="rounded-sm underline underline-offset-4 hover:text-forest-700"
            >
              {t('brands.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {brand.name}
          </li>
        </ol>
      </nav>

      <ProductListingPage
        filters={filters}
        basePath={`/brands/${slug}`}
        title={brand.name}
        intro={brand.description}
        /* Targeting: a placement scoped to this brand's page qualifies here and nowhere else. */
        placementBrandSlug={slug}
      />
    </>
  );
}
