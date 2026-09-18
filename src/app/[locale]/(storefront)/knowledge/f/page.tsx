import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { toArticleType } from '@/features/content/types';
import { KnowledgeHub } from '@/features/content/components/knowledge-hub';

/**
 * Explicitly dynamic. Reading searchParams already forces this, but the static `f` segment
 * gave the build an empty-query shell to prerender optimistically — declaring intent keeps a
 * future refactor from ever serving one cached page for every filter combination.
 */
export const dynamic = 'force-dynamic';
type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'knowledge' });

  return {
    title: t('title'),
    description: t('intro'),
    // A filtered view is a working page, never a search result: the hub is the canonical.
    robots: { index: false, follow: true },
    alternates: {
      canonical: '/knowledge',
      languages: { sq: '/knowledge', en: '/en/knowledge' },
    },
  };
}

/**
 * The Knowledge hub's FILTERED views (owner cost report, 2026-09-18): the sibling that reads
 * `?type/?tag/?page` and therefore renders dynamically — so `/knowledge` itself can stay
 * prerendered. Same `KnowledgeHub` body, so the two are pixel-identical; a link whose filters
 * empty returns to the bare hub.
 */
export default async function KnowledgeFilteredPage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(resolveLocale(rawLocale));

  const page = Number(first(query.page) ?? '1');

  return (
    <KnowledgeHub
      type={toArticleType(first(query.type))}
      tag={first(query.tag)}
      page={Number.isFinite(page) && page > 0 ? Math.min(page, 50) : 1}
    />
  );
}
