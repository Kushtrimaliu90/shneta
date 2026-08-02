import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import type { Locale } from '@/lib/constants';
import { getProtocolGoals } from '@/features/biohack/queries';
import { getApprovedConfig } from '@/features/biohack/config-loader';
import { GoalPicker } from '@/features/biohack/components/goal-picker';
import { RefineForm } from '@/features/biohack/components/refine-form';

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
 * docs/15 §1 — steps 1 and 2 of the BioHack Protocol Generator.
 *
 * Two URLs, one page, chosen by `?step=`, with the answers in the query string — the Finder's
 * shape (docs/05 §10), for the same reasons: the back button becomes "change my last answer" for
 * free, and neither step costs the visitor a byte of state management.
 *
 * Step 3 is not here. It lives at `/biohack/[code]`, because a generated protocol is a thing with
 * an address: it can be reloaded, bookmarked, shared and reopened after signing in, none of which
 * a query string full of answers can do.
 */
export default async function BioHackPage({ params, searchParams }: Props) {
  const [{ locale }, raw] = await Promise.all([params, searchParams]);

  const t = await getTranslations('biohack');
  const goals = await getProtocolGoals();

  const selected = readGoals(raw.goals).filter((slug) =>
    goals.some((goal) => goal.slug === slug),
  );
  const step = raw.step === '2' && selected.length > 0 ? 2 : 1;
  const basePath = locale === 'sq' ? '/biohack' : `/${locale}/biohack`;

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
        {t('step', { current: step, total: 3 })}
      </p>

      {errorMessage && (
        <Alert tone="error" className="mt-4">
          {errorMessage}
        </Alert>
      )}

      <section className="mt-6">
        <h2 className="font-display text-xl font-semibold text-forest-900">
          {step === 1 ? t('goalsTitle') : t('refineTitle')}
        </h2>
        <p className="mt-1 mb-6 text-sm text-ink-600">
          {step === 1 ? t('goalsHint') : t('refineHint')}
        </p>

        {step === 1 ? (
          <GoalPicker goals={goals} selected={selected} action={basePath} />
        ) : (
          <RefineForm
            goals={selected}
            locale={locale}
            budgetTiers={budgetTiers}
            backHref={`${basePath}?${selected.map((slug) => `goals=${slug}`).join('&')}`}
          />
        )}
      </section>

      <p className="mt-10 border-t border-line pt-6 text-xs text-ink-500">{t('disclaimer')}</p>
    </div>
  );
}

/** `?goals=a&goals=b` arrives as an array; a single value arrives as a string. */
function readGoals(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return [...new Set(value)].slice(0, 3);
  return value ? [value] : [];
}
