import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { storageUrl } from '@/lib/storage';
import { ProductListingPage } from '@/features/catalog/components/plp';
import type { ProductFilters } from '@/features/catalog/types';
import { getBrandBySlug } from '@/features/catalog/queries';

/**
 * docs/05 §4 — a brand page is the PLP scoped to that brand, which is what the spec means by
 * "reuses §2 machinery". One body, two routes (owner cost report, 2026-09-18): the bare
 * `/brands/[slug]` renders it unfiltered and is PREBUILT; `/brands/[slug]/f` reads the query
 * and stays dynamic. `getBrandBySlug` is request-cached, so metadata and body share one lookup.
 */
export async function BrandLander({ slug, filters }: { slug: string; filters: ProductFilters }) {
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

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
        filters={{ ...filters, brand: [slug] }}
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
        /* Targeting: a placement scoped to this brand's page qualifies here and nowhere else. */
        placementBrandSlug={slug}
      />
    </>
  );
}
