import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { ProductListingPage } from '@/features/catalog/components/plp';
import { parseFilters, type RawSearchParams } from '@/features/catalog/filters';
import { getGoalBySlug, listGoals } from '@/features/catalog/queries';

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawSearchParams>;
};

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
 * docs/05 §5 — goal detail: hero, the "how to approach {goal}" intro, then recommended
 * products, which is the PLP scoped to that goal.
 *
 * The intro currently renders the `[CONTENT: replace]` marker from the seed. docs/05 §5
 * requires a unique 150+ word intro per goal, and these are the highest-value SEO landing
 * pages in the site — that copy is content work, tracked in docs/14 §3.
 */
export default async function GoalPage({ params, searchParams }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  setRequestLocale(locale);

  const goal = await getGoalBySlug(slug);
  if (!goal) notFound();

  const filters = { ...parseFilters(await searchParams), goal: [slug] };
  const t = await getTranslations();
  const name = pickLocale(goal.name, locale);
  const intro = pickLocale(goal.description, locale);
  const isPlaceholder = intro.includes('[CONTENT');

  return (
    <>
      <nav aria-label={t('shop.breadcrumbs')} className="container-page pt-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
          <li>
            <Link
              href="/goals"
              className="rounded-sm underline underline-offset-4 hover:text-forest-700"
            >
              {t('goals.title')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-900" aria-current="page">
            {name}
          </li>
        </ol>
      </nav>

      <section className="container-page pt-6">
        <p className="eyebrow">{pickLocale(goal.tagline, locale)}</p>
      </section>

      <ProductListingPage
        filters={filters}
        basePath={`/goals/${slug}`}
        title={name}
        // Suppress the placeholder rather than print "[CONTENT: replace]" at a customer.
        intro={isPlaceholder ? undefined : goal.description}
      />

      {/* docs/08 §7.3 — required on goal pages, which are educational surfaces. */}
      <div className="container-page pb-12">
        <p className="max-w-3xl border-t border-line pt-6 text-xs leading-relaxed text-ink-500">
          {t('footer.disclaimer')}
        </p>
      </div>
    </>
  );
}
