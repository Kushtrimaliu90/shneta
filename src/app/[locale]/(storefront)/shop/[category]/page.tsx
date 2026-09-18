import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { parseFilters } from '@/features/catalog/filters';
import { getCategoryBySlug, getCategoryTree } from '@/features/catalog/queries';
import { CategoryLander } from './category-lander';

type Props = { params: Promise<{ locale: string; category: string }> };

/** docs/02 §5 — the catalogue tier. */
// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

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
 * The unfiltered category lander, PREBUILT (owner cost report, 2026-09-18): it reads no
 * searchParams — the read is what had every category view rendering on a server despite the
 * generateStaticParams above. Filtered views live at `./f`; see `CategoryLander`.
 */
export default async function CategoryPage({ params }: Props) {
  const { locale: rawLocale, category: slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  return <CategoryLander slug={slug} locale={locale} filters={parseFilters({})} />;
}
