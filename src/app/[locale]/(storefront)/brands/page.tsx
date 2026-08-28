import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { storageUrl } from '@/lib/storage';
import { listBrands } from '@/features/catalog/queries';
import { EmptyState } from '@/components/shared/empty-state';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'brands',
  });
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: { canonical: '/brands', languages: { sq: '/brands', en: '/en/brands' } },
  };
}

/**
 * How many brands it takes before the alphabet earns its keep.
 *
 * docs/05 §4 asks for an alphabet-grouped index, and with eight brands that meant eight sections
 * of one or two tiles each — grouping structure with nothing to group, and letter headings
 * outnumbering some letters' contents. Below this threshold the index is one flat grid a visitor
 * scans in a glance; at or above it the grouped path below takes over, because that is the point
 * where "jump to S" beats "read them all". Recorded in docs/13 §BA. The search-as-you-type
 * filter from the spec stays deliberately absent for the same population reason.
 */
const GROUPING_THRESHOLD = 20;

/** One brand, one tile: the logo on a white pad, the name and country under it. */
function BrandTile({
  brand,
}: {
  brand: { slug: string; name: string; country_code: string | null; logo_path: string | null };
}) {
  return (
    <Link
      href={`/brands/${brand.slug}`}
      /* `card-interactive` — the shared ring-and-lift recipe (globals.css). */
      className="flex h-full card-interactive flex-col overflow-hidden rounded-lg"
    >
      {/*
        The logo pad. Logos are trademark artwork with their own background rules, so the pad is
        plain white with `object-contain` — never cropped, never tinted. When `logo_path` is null
        (the seed leaves it so until each mark is licensed) the pad becomes a forest-50 monogram
        panel: deliberate surface, not missing image — the same argument as the article card's
        no-cover fallback.
      */}
      {brand.logo_path ? (
        <div className="relative h-24 bg-white p-5">
          <Image
            src={storageUrl('brand-assets', brand.logo_path)}
            /* Decorative: the brand's name is the next line of the same link. */
            alt=""
            fill
            sizes="(min-width: 1024px) 20rem, (min-width: 640px) 50vw, 100vw"
            className="object-contain"
          />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center bg-forest-50" aria-hidden="true">
          <span className="font-display text-3xl font-semibold text-forest-600">
            {brand.name[0]?.toUpperCase() ?? '#'}
          </span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-between gap-3 border-t border-line/60 px-4 py-3">
        <span className="font-medium text-ink-900">{brand.name}</span>
        {brand.country_code && (
          <span className="font-ui text-xs text-ink-500">{brand.country_code}</span>
        )}
      </div>
    </Link>
  );
}

/** docs/05 §4 — the brand index: a logo grid, alphabet-grouped once it is long enough to need it. */
export default async function BrandsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const brands = await listBrands();
  const t = await getTranslations('brands');

  const sorted = [...brands].sort((a, b) => a.name.localeCompare(b.name));

  const groups = new Map<string, typeof brands>();
  for (const brand of sorted) {
    const letter = brand.name[0]?.toUpperCase() ?? '#';
    groups.set(letter, [...(groups.get(letter) ?? []), brand]);
  }

  return (
    <div className="container-wide py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      {brands.length === 0 ? (
        <EmptyState title={t('empty')} className="mt-10" />
      ) : brands.length < GROUPING_THRESHOLD ? (
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5">
          {sorted.map((brand) => (
            <li key={brand.slug}>
              <BrandTile brand={brand} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-10 flex flex-col gap-10">
          {[...groups.entries()].map(([letter, entries]) => (
            <section key={letter} aria-labelledby={`brand-group-${letter}`}>
              <h2
                id={`brand-group-${letter}`}
                className="border-b border-line pb-2 font-display text-xl font-semibold text-forest-900"
              >
                {letter}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-5">
                {entries.map((brand) => (
                  <li key={brand.slug}>
                    <BrandTile brand={brand} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
