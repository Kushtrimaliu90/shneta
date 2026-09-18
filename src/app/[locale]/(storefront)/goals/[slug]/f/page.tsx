import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getGoalBySlug } from '@/features/catalog/queries';
import { GoalLander } from '../goal-lander';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const goal = await getGoalBySlug(slug);
  if (!goal) return {};

  /* A filtered view is never a search result; the bare goal page is the canonical. */
  return {
    title: pickLocale(goal.name, locale),
    robots: { index: false, follow: true },
    alternates: {
      canonical: `/goals/${slug}`,
      languages: { sq: `/goals/${slug}`, en: `/en/goals/${slug}` },
    },
  };
}

/**
 * The goal page's FILTERED views — the dynamic sibling that reads searchParams so the lander
 * itself can stay prebuilt (owner cost report, 2026-09-18). Same `GoalLander` body.
 */
export default async function GoalFilteredPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  return <GoalLander slug={slug} locale={locale} filters={parseFilters(await searchParams)} />;
}
