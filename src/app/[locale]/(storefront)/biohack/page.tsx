import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import type { Locale } from '@/lib/constants';
import { getProtocolGoals } from '@/features/biohack/queries';
import { getApprovedConfig } from '@/features/biohack/config-loader';
import { GoalPicker } from '@/features/biohack/components/goal-picker';
import { AboutYouForm } from '@/features/biohack/components/about-you-form';
import { RefineForm } from '@/features/biohack/components/refine-form';
import {
  answersToParams,
  readAnswerParams,
  type ProtocolAnswers,
} from '@/features/biohack/schemas';

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'biohack' });

  return {
    title: t('title'),
    description: t('intro'),
    /*
     * docs/15 §1 — noindex. The page is a form whose only content is the questions; the value is
     * the generated protocol, which is per-person and lives behind a share code. Indexing the
     * shell would put a thin page in search results competing with the goal landing pages that
     * are actually written for it.
     */
    robots: { index: false, follow: true },
  };
}

/**
 * docs/15 §1, §9 — the three question steps: goals, about you, refine.
 *
 * Three URLs, one page, chosen by `?step=`, with every answer in the query string — the Finder's
 * shape (docs/05 §10), for the same reasons: the back button becomes "change my last answer" for
 * free, and no step costs the visitor a byte of state management.
 *
 * **Four steps rather than the three docs/15 §1 specified**, because personalisation added five
 * questions and putting eleven on one screen is a worse trade than one more tap. The <60 s
 * acceptance criterion still holds and is still asserted in `e2e/biohack.spec.ts` — every one of
 * the new questions is a single tap, and all five may be skipped.
 *
 * The result is not one of these steps. It lives at `/biohack/[code]`, because a generated protocol
 * is a thing with an address: reloadable, bookmarkable, shareable, and reopenable after signing in,
 * none of which a query string full of answers can do.
 */
export default async function BioHackPage({ params, searchParams }: Props) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);

  const t = await getTranslations('biohack');
  const goals = await getProtocolGoals();

  const selected = readGoals(raw.goals).filter((slug) =>
    goals.some((goal) => goal.slug === slug),
  );

  /*
   * Three question steps now, not two (docs/15 §9).
   *
   * Steps 2 and 3 both require goals, so a URL that names a later step without them falls back to
   * step 1 rather than rendering a form whose submit cannot validate.
   */
  const requested = raw.step === '3' ? 3 : raw.step === '2' ? 2 : 1;
  const step = selected.length > 0 ? requested : 1;
  const basePath = locale === 'sq' ? '/biohack' : `/${locale}/biohack`;

  /*
   * Step 2's answers arrive in the query string and are needed by step 3, which forwards them as
   * hidden fields. Parsed through the same schema the action uses, so an edited URL cannot smuggle
   * a band the engine does not know.
   */
  const profileParams = new URLSearchParams();
  for (const slug of selected) profileParams.append('goals', slug);
  for (const key of ['ageBand', 'sex', 'weightBand', 'heightBand', 'activity'] as const) {
    const value = typeof raw[key] === 'string' ? (raw[key] as string) : null;
    if (value) profileParams.set(key, value);
  }
  /*
   * Defaults written out rather than obtained from the schema.
   *
   * `protocolAnswersSchema.parse({ goals: selected })` looks tidier and throws: `goals` has a
   * `min(1)`, and on step 1 nothing is selected yet, so the whole page rendered the error boundary
   * — "Something went wrong" in place of the first question. A throwing parse has no business in a
   * render path where the invalid case is the normal one.
   */
  const parsedProfile = readAnswerParams(profileParams);
  const answers: ProtocolAnswers = parsedProfile.success
    ? parsedProfile.data
    : {
        goals: selected,
        diet: 'pa_kufizime',
        caffeine: 'po',
        restrictedLifeStage: false,
        medication: false,
        level: 'fillestar',
        budget: 'any',
      };

  const errorKey = typeof raw.gabim === 'string' ? raw.gabim : null;
  const errorMessage =
    errorKey === 'shume' ? t('errorTooMany') : errorKey ? t('errorGeneric') : null;

  /*
   * The tiers come from the approved config so the three budget options always name the numbers
   * the engine will actually apply. Null config falls back to the documented defaults rather than
   * hiding the question — the generator will fail later with a clear message, and a customer
   * halfway through a form should not watch a field disappear.
   */
  const config = await getApprovedConfig();
  const budgetTiers = config?.settings.budgetTiers ?? [2000, 4000];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:py-14">
      <p className="font-ui text-xs font-semibold tracking-wider text-forest-700 uppercase">
        {t('eyebrow')}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-forest-900 sm:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-600">{t('intro')}</p>

      <p className="mt-6 font-ui text-sm text-ink-500" data-numeric>
        {t('step', { current: step, total: 4 })}
      </p>

      {errorMessage && (
        <Alert tone="error" className="mt-4">
          {errorMessage}
        </Alert>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl font-semibold text-forest-900">
          {step === 1 ? t('goalsTitle') : step === 2 ? t('aboutYouTitle') : t('refineTitle')}
        </h2>
        <p className="mt-1 mb-6 text-sm text-ink-600">
          {step === 1 ? t('goalsHint') : step === 2 ? t('aboutYouHint') : t('refineHint')}
        </p>

        {step === 1 && <GoalPicker goals={goals} selected={selected} action={basePath} />}

        {step === 2 && (
          <AboutYouForm
            goals={selected}
            answers={answers}
            action={basePath}
            backHref={`${basePath}?${goalsQuery(selected)}`}
          />
        )}

        {step === 3 && (
          <RefineForm
            goals={selected}
            answers={answers}
            locale={locale}
            budgetTiers={budgetTiers}
            /*
             * Back to step 2 with the bands still in the URL, so returning does not silently
             * discard five answers — the property the whole query-string design exists for.
             */
            backHref={`${basePath}?step=2&${answersToParams(answers).toString()}`}
          />
        )}
      </section>

      <p className="mt-10 border-t border-line pt-6 text-xs text-ink-500">{t('disclaimer')}</p>
    </div>
  );
}

/** Goals as a query fragment, for the back links. */
function goalsQuery(slugs: string[]): string {
  return slugs.map((slug) => 'goals=' + encodeURIComponent(slug)).join('&');
}

/** `?goals=a&goals=b` arrives as an array; a single value arrives as a string. */
function readGoals(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return [...new Set(value)].slice(0, 3);
  return value ? [value] : [];
}
