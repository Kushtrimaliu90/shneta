import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { listIngredients } from '@/features/catalog/queries';
import { ingredientCategory, type IngredientCategory } from '@/features/catalog/filters';
import { EvidenceBadge } from '@/components/storefront/evidence-badge';
import { EmptyState } from '@/components/shared/empty-state';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'ingredients',
  });
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: {
      canonical: '/ingredients',
      languages: { sq: '/ingredients', en: '/en/ingredients' },
    },
  };
}

/** docs/05 §6 — A–Z list grouped by category (vitamin, mineral, herb, amino…). */
export default async function IngredientsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const ingredients = await listIngredients();
  const t = await getTranslations('ingredients');

  const groups = new Map<IngredientCategory, typeof ingredients>();
  for (const ingredient of ingredients) {
    const key = ingredientCategory(ingredient.category);
    groups.set(key, [...(groups.get(key) ?? []), ingredient]);
  }

  return (
    <div className="container-wide py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      {ingredients.length === 0 ? (
        <EmptyState title={t('empty')} className="mt-10" />
      ) : (
        <div className="mt-10 flex flex-col gap-10">
          {[...groups.entries()].map(([category, entries]) => (
            <section key={category} aria-labelledby={`ingredient-group-${category}`}>
              <h2
                id={`ingredient-group-${category}`}
                className="border-b border-line pb-2 font-display text-xl font-semibold text-forest-900"
              >
                {t(`categories.${category}`)}
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {entries.map((ingredient) => (
                  <li key={ingredient.slug}>
                    <Link
                      href={`/ingredients/${ingredient.slug}`}
                      className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink-900">
                          {pickLocale(ingredient.name, locale)}
                        </span>
                        <EvidenceBadge evidence={ingredient.evidence} />
                      </span>
                      <span className="line-clamp-2 text-sm text-ink-600">
                        {pickLocale(ingredient.summary, locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* docs/08 §7.3 — mandatory on ingredient surfaces. */}
      <p className="mt-12 max-w-3xl border-t border-line pt-6 text-xs leading-relaxed text-ink-500">
        {t('disclaimer')}
      </p>
    </div>
  );
}
