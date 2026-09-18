import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getCategoryBySlug } from '@/features/catalog/queries';
import { CategoryLander } from '../category-lander';

type Props = {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, category: slug } = await params;
  const locale = resolveLocale(rawLocale);
  const category = await getCategoryBySlug(slug);
  if (!category) return {};

  /* A filtered view is never a search result; the bare category page is the canonical. */
  return {
    title: pickLocale(category.name, locale),
    robots: { index: false, follow: true },
    alternates: {
      canonical: `/shop/${slug}`,
      languages: { sq: `/shop/${slug}`, en: `/en/shop/${slug}` },
    },
  };
}

/**
 * The category's FILTERED views — the dynamic sibling that reads searchParams so the lander
 * itself can stay prebuilt (owner cost report, 2026-09-18). Same `CategoryLander` body.
 */
export default async function CategoryFilteredPage({ params, searchParams }: Props) {
  const { locale: rawLocale, category: slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  return <CategoryLander slug={slug} locale={locale} filters={parseFilters(await searchParams)} />;
}
