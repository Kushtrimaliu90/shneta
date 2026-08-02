import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ShieldAlert } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { truncate } from '@/lib/utils';
import { EvidenceBadge } from '@/components/storefront/evidence-badge';
import { ProductCard } from '@/components/storefront/product-card';
import { EmptyState } from '@/components/shared/empty-state';
import { getIngredientBySlug, listIngredients, listProducts } from '@/features/catalog/queries';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 300;

export async function generateStaticParams() {
  const ingredients = await listIngredients();
  return ingredients.map((ingredient) => ({ slug: ingredient.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const ingredient = await getIngredientBySlug(slug);
  if (!ingredient) return {};

  const name = pickLocale(ingredient.name, locale);
  return {
    title: name,
    description: truncate(pickLocale(ingredient.summary, locale), 155) || undefined,
    alternates: {
      canonical: `/ingredients/${slug}`,
      languages: { sq: `/ingredients/${slug}`, en: `/en/ingredients/${slug}` },
    },
  };
}

/**
 * docs/05 §6 — ingredient detail: names, evidence badge, summary, benefits, dosage, safety
 * notes as a distinct callout, then the products containing it.
 *
 * Safety notes are always visible when present — that is the acceptance criterion, and it is
 * the reason this page exists as an educational surface rather than a marketing one.
 */
export default async function IngredientPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const ingredient = await getIngredientBySlug(slug);
  if (!ingredient) notFound();

  const [products, t] = await Promise.all([
    listProducts({ ingredient: [slug] }),
    getTranslations(),
  ]);

  const name = pickLocale(ingredient.name, locale);
  const safety = pickLocale(ingredient.safetyNotes, locale);

  return (
    <div className="container-page py-8 lg:py-12">
      <nav aria-label={t('shop.breadcrumbs')} className="mb-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/ingredients"
              className="rounded-sm underline underline-offset-4 hover:text-carbon-700"
            >
              {t('ingredients.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {name}
          </li>
        </ol>
      </nav>

      <div className="grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
              {name}
            </h1>
            <EvidenceBadge evidence={ingredient.evidence} />
          </div>

          {ingredient.otherNames.length > 0 && (
            <p className="mt-2 text-sm text-ink-500">
              {t('ingredients.alsoKnownAs')}: {ingredient.otherNames.join(', ')}
            </p>
          )}

          {pickLocale(ingredient.summary, locale) && (
            <p className="mt-6 leading-relaxed text-ink-600">
              {pickLocale(ingredient.summary, locale)}
            </p>
          )}

          {pickLocale(ingredient.benefits, locale) && (
            <section className="mt-10">
              <h2 className="font-display text-xl font-semibold text-carbon-900">
                {t('ingredients.benefits')}
              </h2>
              <p className="mt-3 leading-relaxed text-ink-600">
                {pickLocale(ingredient.benefits, locale)}
              </p>
            </section>
          )}

          {pickLocale(ingredient.dosageNotes, locale) && (
            <section className="mt-10">
              <h2 className="font-display text-xl font-semibold text-carbon-900">
                {t('ingredients.dosage')}
              </h2>
              <p className="mt-3 leading-relaxed text-ink-600">
                {pickLocale(ingredient.dosageNotes, locale)}
              </p>
            </section>
          )}

          {/* docs/05 §6 — safety notes always visible, as a distinct callout. */}
          {safety && (
            <section className="mt-10">
              <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <h2 className="font-medium text-ink-900">{t('ingredients.safety')}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600">{safety}</p>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside>
          <p className="text-xs leading-relaxed text-ink-500">{t('ingredients.disclaimer')}</p>
        </aside>
      </div>

      <section className="mt-16">
        <h2 className="font-display text-2xl font-semibold text-carbon-900">
          {t('ingredients.productsContaining', { name })}
        </h2>

        {products.items.length === 0 ? (
          <EmptyState title={t('ingredients.noProducts')} className="mt-6" />
        ) : (
          <ol className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
            {products.items.map((product) => (
              <li key={product.id} className="flex">
                <ProductCard product={product} className="w-full" />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
