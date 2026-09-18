import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getBrandBySlug } from '@/features/catalog/queries';
import { BrandLander } from '../brand-lander';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return {};

  /* A filtered view is never a search result; the bare brand page is the canonical. */
  return {
    title: brand.name,
    robots: { index: false, follow: true },
    alternates: {
      canonical: `/brands/${slug}`,
      languages: { sq: `/brands/${slug}`, en: `/en/brands/${slug}` },
    },
  };
}

/**
 * The brand page's FILTERED views — the dynamic sibling that reads searchParams so the lander
 * itself can stay prebuilt (owner cost report, 2026-09-18). Same `BrandLander` body.
 */
export default async function BrandFilteredPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  setRequestLocale(resolveLocale(rawLocale));

  return <BrandLander slug={slug} filters={parseFilters(await searchParams)} />;
}
