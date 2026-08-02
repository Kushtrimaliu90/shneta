import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { listGoals } from '@/features/catalog/queries';
import { EmptyState } from '@/components/shared/empty-state';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'goals',
  });
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: { canonical: '/goals', languages: { sq: '/goals', en: '/en/goals' } },
  };
}

/** docs/05 §5 — the 16 goal tiles. These are key SEO landing pages. */
export default async function GoalsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const goals = await listGoals();
  const t = await getTranslations('goals');

  return (
    <div className="container-page py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      {goals.length === 0 ? (
        <EmptyState title={t('empty')} className="mt-10" />
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {goals.map((goal) => (
            <li key={goal.slug}>
              <Link
                href={`/goals/${goal.slug}`}
                className="flex min-h-28 flex-col justify-end rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500"
              >
                <span className="font-medium text-ink-900">{pickLocale(goal.name, locale)}</span>
                {pickLocale(goal.tagline, locale) && (
                  <span className="mt-1 line-clamp-2 text-xs text-ink-500">
                    {pickLocale(goal.tagline, locale)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
