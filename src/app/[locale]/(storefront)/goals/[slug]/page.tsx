import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { parseFilters } from '@/features/catalog/filters';
import { getGoalBySlug, listGoals } from '@/features/catalog/queries';
import { GoalLander } from './goal-lander';

type Props = { params: Promise<{ locale: string; slug: string }> };

/** docs/02 §5 — the catalogue tier. */
// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

/** docs/02 §5 — all goals are prebuilt. */
export async function generateStaticParams() {
  const goals = await listGoals();
  return goals.map((goal) => ({ slug: goal.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const goal = await getGoalBySlug(slug);
  if (!goal) return {};

  const name = pickLocale(goal.name, locale);
  return {
    title: name,
    description: pickLocale(goal.tagline, locale) || undefined,
    alternates: {
      canonical: `/goals/${slug}`,
      languages: { sq: `/goals/${slug}`, en: `/en/goals/${slug}` },
    },
  };
}

/**
 * The unfiltered goal lander, PREBUILT (owner cost report, 2026-09-18): it reads no
 * searchParams — the read is what had the site's highest-value SEO landing pages rendering on
 * a server per view despite the generateStaticParams above. Filtered views live at `./f`;
 * see `GoalLander`.
 */
export default async function GoalPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  return <GoalLander slug={slug} locale={locale} filters={parseFilters({})} />;
}
