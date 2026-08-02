import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { listBrands } from '@/features/catalog/queries';
import { EmptyState } from '@/components/shared/empty-state';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

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
 * docs/05 §4 — alphabet-grouped brand index.
 *
 * The search-as-you-type filter from the spec is deliberately not here: with eight brands it
 * would be a client bundle solving a problem that does not exist. Grouping is enough until
 * the list is long enough to need filtering.
 */
export default async function BrandsPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const brands = await listBrands();
  const t = await getTranslations('brands');

  const groups = new Map<string, typeof brands>();
  for (const brand of [...brands].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = brand.name[0]?.toUpperCase() ?? '#';
    groups.set(letter, [...(groups.get(letter) ?? []), brand]);
  }

  return (
    <div className="container-page py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      {brands.length === 0 ? (
        <EmptyState title={t('empty')} className="mt-10" />
      ) : (
        <div className="mt-10 flex flex-col gap-10">
          {[...groups.entries()].map(([letter, entries]) => (
            <section key={letter} aria-labelledby={`brand-group-${letter}`}>
              <h2
                id={`brand-group-${letter}`}
                className="border-b border-line pb-2 font-display text-xl font-semibold text-carbon-900"
              >
                {letter}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((brand) => (
                  <li key={brand.slug}>
                    <Link
                      href={`/brands/${brand.slug}`}
                      className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 transition-colors hover:border-carbon-500"
                    >
                      <span className="font-medium text-ink-900">{brand.name}</span>
                      {brand.country_code && (
                        <span className="font-ui text-xs text-ink-500">{brand.country_code}</span>
                      )}
                    </Link>
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
