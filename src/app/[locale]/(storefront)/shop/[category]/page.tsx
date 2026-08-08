import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getCategoryBySlug, getCategoryTree } from '@/features/catalog/queries';

type Props = {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<RawSearchParams>;
};

/** docs/02 §5 — all categories are prebuilt. */
export async function generateStaticParams() {
  const tree = await getCategoryTree();
  const flatten = (nodes: Awaited<ReturnType<typeof getCategoryTree>>): string[] =>
    nodes.flatMap((node) => [node.slug, ...flatten(node.children)]);
  return flatten(tree).map((category) => ({ category }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, category: slug } = await params;
  const locale = resolveLocale(rawLocale);
  const category = await getCategoryBySlug(slug);
  if (!category) return {};

  const name = pickLocale(category.name, locale);
  const description = pickLocale(category.description, locale);

  return {
    title: name,
    description: description || undefined,
    alternates: {
      canonical: `/shop/${slug}`,
      languages: { sq: `/shop/${slug}`, en: `/en/shop/${slug}` },
    },
  };
}

/**
 * docs/05 §2 — a category page is the PLP scoped to one category, plus the localized intro.
 * The category slug is applied as a filter rather than a separate query path, so sorting and
 * the other filters compose with it.
 */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: rawLocale, category: slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const filters = { ...parseFilters(await searchParams), category: [slug] };
  const t = await getTranslations();
  const name = pickLocale(category.name, locale);

  return (
    <>
      <nav aria-label={t('shop.breadcrumbs')} className="container-page pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/shop"
              className="rounded-sm underline underline-offset-4 hover:text-forest-700"
            >
              {t('shop.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {name}
          </li>
        </ol>
      </nav>

      <ProductListingPage
        filters={filters}
        basePath={`/shop/${slug}`}
        title={name}
        intro={category.description}
        /* Targeting: a placement scoped to this category qualifies here and nowhere else. */
        placementCategorySlug={slug}
      />
    </>
  );
}
