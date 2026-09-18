import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { parseFilters } from '@/features/catalog/filters';
import { getBrandBySlug, listBrands } from '@/features/catalog/queries';
import { BrandLander } from './brand-lander';

type Props = { params: Promise<{ locale: string; slug: string }> };

/** docs/02 §5 — the catalogue tier. */
// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

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
 * The unfiltered brand lander, PREBUILT (owner cost report, 2026-09-18): it reads no
 * searchParams — the read is what had every brand-page view rendering on a server despite the
 * generateStaticParams above. Filtered views live at `./f`; see `BrandLander`.
 */
export default async function BrandPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  setRequestLocale(resolveLocale(rawLocale));

  return <BrandLander slug={slug} filters={parseFilters({})} />;
}
