import Image from 'next/image';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { storageUrl } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { listGoals } from '@/features/catalog/queries';
import { EmptyState } from '@/components/shared/empty-state';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `STATIC_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 86400;

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
    <div className="container-wide py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      {goals.length === 0 ? (
        <EmptyState title={t('empty')} className="mt-10" />
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 3xl:grid-cols-6">
          {goals.map((goal) => (
            <li key={goal.slug}>
              <Link
                href={`/goals/${goal.slug}`}
                /* `card-interactive` — the shared ring-and-lift recipe (globals.css), not a bespoke one. */
                className="group flex h-full card-interactive flex-col overflow-hidden rounded-lg"
              >
                {/*
                  The picture an admin set, or a tinted panel. Same rule as the homepage category row: a
                  chosen image wins, and its absence is a deliberate surface rather than a gap. Goals had
                  no artwork at all before — `health_goals.image_path` existed and nothing rendered it.
                */}
                <div
                  className={cn(
                    'relative aspect-[3/2] overflow-hidden',
                    goal.imagePath ? 'bg-white' : 'bg-gradient-to-br from-forest-50 to-lime-500/10',
                  )}
                >
                  {goal.imagePath && (
                    <Image
                      src={storageUrl('brand-assets', goal.imagePath)}
                      alt={pickLocale(goal.name, locale)}
                      fill
                      sizes="(min-width: 1024px) 16rem, (min-width: 640px) 30vw, 45vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  )}
                </div>

                <div className="flex min-h-20 flex-col justify-end p-4">
                  <span className="font-medium text-ink-900">{pickLocale(goal.name, locale)}</span>
                  {pickLocale(goal.tagline, locale) && (
                    <span className="mt-1 line-clamp-2 text-xs text-ink-500">
                      {pickLocale(goal.tagline, locale)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
