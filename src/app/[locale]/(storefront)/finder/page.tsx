import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { pickLocaleFrom } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { readAnswers, readStep } from '@/features/finder/answers';
import { getFinderCandidates, getFinderGoals, getRoutineProducts } from '@/features/finder/queries';
import { buildRoutine, completeness } from '@/features/finder/scoring';
import {
  StepConstraints,
  StepEmail,
  StepLifestyle,
  StepPrimary,
  StepSecondary,
} from '@/features/finder/components/finder-steps';
import {
  FinderResults,
  type RoutineItem,
} from '@/features/finder/components/finder-results';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'finder' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: { canonical: '/finder', languages: { sq: '/finder', en: '/en/finder' } },
  };
}

/**
 * docs/05 §10 — the supplement finder.
 *
 * Six URLs, one page: five question steps and the results, chosen by `?step=`. Everything is a
 * Server Component except the results actions, so the quiz costs the visitor no JavaScript to
 * answer — which matters on the mid-range Android over mobile data that docs/01 §4 names as the
 * target device.
 *
 * The whole answer set lives in the query string. That is what makes the browser's back button
 * work as "change my last answer" (an acceptance criterion) without a line of state management,
 * and it means a customer can send someone their answers as a link.
 */
export default async function FinderPage({ params, searchParams }: Props) {
  const [{ locale }, rawParams] = await Promise.all([params, searchParams]);

  const answers = readAnswers(rawParams);
  const step = readStep(rawParams);
  const goals = await getFinderGoals();

  // Unprefixed for `sq` (the default locale), prefixed for everything else.
  const basePath = locale === 'sq' ? '/finder' : `/${locale}/finder`;
  const stepProps = { answers, goals, locale, basePath };

  if (step === 1 || !answers.primary) {
    return (
      <Shell>
        <StepPrimary {...stepProps} />
      </Shell>
    );
  }
  if (step === 2) {
    return (
      <Shell>
        <StepSecondary {...stepProps} />
      </Shell>
    );
  }
  if (step === 3) {
    return (
      <Shell>
        <StepLifestyle {...stepProps} />
      </Shell>
    );
  }
  if (step === 4) {
    return (
      <Shell>
        <StepConstraints {...stepProps} />
      </Shell>
    );
  }
  if (step === 5) {
    return (
      <Shell>
        <StepEmail {...stepProps} />
      </Shell>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────
  const candidates = await getFinderCandidates();
  const routine = buildRoutine(candidates, answers);
  const products = await getRoutineProducts(routine.products.map((p) => p.productId));

  const t = await getTranslations('finder');
  const goalName = (slug: string | undefined): string => {
    if (!slug) return '';
    const goal = goals.find((entry) => entry.slug === slug);
    return goal ? pickLocaleFrom(goal.name, locale) : slug;
  };

  /*
   * The "why" line is built here, on the server, rather than passed as reason objects the client
   * would localize. The reasons reference goal slugs, and resolving a slug to a name needs the
   * goals list — sending that to the browser to render one sentence per card is a payload for
   * nothing.
   */
  const items: RoutineItem[] = products.map((product) => {
    const scored = routine.products.find((entry) => entry.productId === product.id);
    const primary = scored?.reasons.find((reason) => reason.kind === 'primary');
    const secondary = scored?.reasons.find((reason) => reason.kind === 'secondary');
    const rated = scored?.reasons.some((reason) => reason.kind === 'rating');

    let why: string;
    if (primary) why = t('whyPrimary', { goal: goalName(primary.goalSlug) });
    else if (secondary) why = t('whySecondary', { goal: goalName(secondary.goalSlug) });
    else if (rated) why = t('whyRating');
    else why = t('whyFallback');

    return { product, why };
  });

  return (
    <Shell>
      <FinderResults
        items={items}
        completenessPercent={completeness(routine.products, answers)}
        isFallback={routine.isFallback}
        answersJson={JSON.stringify(answers)}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">{children}</div>;
}
