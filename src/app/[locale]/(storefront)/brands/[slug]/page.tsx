import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { storageUrl } from '@/lib/storage';
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
        /*
          docs/05 §4 — "brand banner, logo". Both were fetched from the day this page existed and
          rendered nowhere, so a brand page was the shop grid with a different h1. Both assets are
          admin-uploaded to `brand-assets` and both are optional — the seed leaves them null until
          each mark is licensed — so each slot simply stays empty until the file exists.
        */
        media={
          brand.logoPath ? (
            <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg bg-white p-2 ring-1 ring-line/60 lg:size-16">
              <Image
                src={storageUrl('brand-assets', brand.logoPath)}
                /* Decorative: the h1 beside it is the brand's name. */
                alt=""
                fill
                sizes="64px"
                className="object-contain"
              />
            </span>
          ) : undefined
        }
        banner={
          brand.bannerPath ? (
            /*
              A band, not a billboard — the same height discipline as the placement banner
              (`placement-banner.tsx`): the aspect ratios are the floor for narrow screens and
              `lg:max-h-[12.5rem]` stops the band inflating with the monitor.
            */
            <div className="relative aspect-[2/1] w-full overflow-hidden rounded-lg sm:aspect-[4/1] lg:aspect-[5/1] lg:max-h-[12.5rem]">
              <Image
                src={storageUrl('brand-assets', brand.bannerPath)}
                /* Decorative: the header below carries the brand's name and logo. */
                alt=""
                fill
                sizes="(min-width: 1280px) 1600px, 100vw"
                className="object-cover"
              />
            </div>
          ) : undefined
        }
        intro={brand.description}
        /* Targeting: a placement scoped to this brand's page qualifies here and nowhere else. */
        placementBrandSlug={slug}
      />
    </>
  );
}
