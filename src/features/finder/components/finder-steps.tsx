import { getTranslations } from 'next-intl/server';
import { pickLocaleFrom } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import {
  ACTIVITY_LEVELS,
  AVOIDABLE_TAGS,
  DIETS,
  FORMS,
  SLEEP_LEVELS,
  TOTAL_STEPS,
  type FinderAnswers,
} from '@/features/finder/types';
import { answersToParams } from '@/features/finder/answers';
import { submitFinder } from '@/features/finder/actions';
import type { FinderGoal } from '@/features/finder/queries';
import { cn } from '@/lib/utils';

/**
 * docs/05 §10 — the quiz steps.
 *
 * Server Components, every one. Each step is a GET form whose fields carry the answers so far as
 * hidden inputs, so submitting produces a new URL and the browser's back button walks the quiz
 * backwards with the answers intact — the acceptance criterion, met by using the platform rather
 * than by restoring state.
 */

const TAG_KEYS: Record<string, string> = {
  gluten_free: 'tagGlutenFree',
  lactose_free: 'tagLactoseFree',
  sugar_free: 'tagSugarFree',
  non_gmo: 'tagNonGmo',
};

/** The answers already given, as hidden inputs, minus the ones this step is about to set. */
function CarriedAnswers({ answers, omit }: { answers: FinderAnswers; omit: string[] }) {
  const params = answersToParams(answers);
  for (const key of omit) params.delete(key);

  return (
    <>
      {[...params.entries()].map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}

function StepShell({
  step,
  title,
  hint,
  children,
  stepLabel,
  backHref,
  backLabel,
  nextLabel,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  stepLabel: string;
  backHref: string | null;
  backLabel: string;
  nextLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <p className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
          {stepLabel}
        </p>
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-forest-100"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-label={stepLabel}
        >
          <div
            className="h-full rounded-full bg-forest-800 transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="mt-4 font-display text-2xl font-semibold text-forest-900 sm:text-3xl">
        {title}
      </h1>
      {hint && <p className="mt-1 text-sm text-ink-600">{hint}</p>}

      <div className="mt-6">{children}</div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          className="inline-flex h-11 items-center rounded-sm bg-forest-800 px-5 text-base text-white hover:bg-forest-700"
        >
          {nextLabel}
        </button>
        {backHref && (
          <a href={backHref} className="text-sm text-forest-800 underline underline-offset-4">
            {backLabel}
          </a>
        )}
      </div>
    </div>
  );
}

/** A goal tile — a radio or a checkbox styled as a card, never a bare list of names. */
function GoalTile({
  type,
  name,
  value,
  label,
  checked,
}: {
  type: 'radio' | 'checkbox';
  name: string;
  value: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2.5 text-sm transition-colors',
        'has-[:checked]:border-forest-800 has-[:checked]:bg-forest-100 has-[:checked]:font-medium',
        'border-line-strong text-ink-900 hover:bg-forest-50',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-4 accent-forest-800"
      />
      {label}
    </label>
  );
}

interface StepProps {
  answers: FinderAnswers;
  goals: FinderGoal[];
  locale: Locale;
  basePath: string;
}

export async function StepPrimary({ answers, goals, locale, basePath }: StepProps) {
  const t = await getTranslations('finder');

  return (
    <form action={basePath} method="get">
      <input type="hidden" name="step" value="2" />
      <CarriedAnswers answers={answers} omit={['primary']} />

      <StepShell
        step={1}
        stepLabel={t('step', { current: 1, total: TOTAL_STEPS })}
        title={t('step1Title')}
        hint={t('step1Hint')}
        backHref={null}
        backLabel={t('back')}
        nextLabel={t('next')}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalTile
              key={goal.slug}
              type="radio"
              name="primary"
              value={goal.slug}
              label={pickLocaleFrom(goal.name, locale)}
              checked={answers.primary === goal.slug}
            />
          ))}
        </div>
      </StepShell>
    </form>
  );
}

export async function StepSecondary({ answers, goals, locale, basePath }: StepProps) {
  const t = await getTranslations('finder');
  const params = answersToParams(answers);
  params.delete('secondary');
  params.set('step', '1');

  return (
    <form action={basePath} method="get">
      <input type="hidden" name="step" value="3" />
      <CarriedAnswers answers={answers} omit={['secondary']} />

      <StepShell
        step={2}
        stepLabel={t('step', { current: 2, total: TOTAL_STEPS })}
        title={t('step2Title')}
        hint={t('step2Hint')}
        backHref={`${basePath}?${params.toString()}`}
        backLabel={t('back')}
        nextLabel={t('next')}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {goals
            .filter((goal) => goal.slug !== answers.primary)
            .map((goal) => (
              <GoalTile
                key={goal.slug}
                type="checkbox"
                name="secondary"
                value={goal.slug}
                label={pickLocaleFrom(goal.name, locale)}
                checked={answers.secondary.includes(goal.slug)}
              />
            ))}
        </div>
      </StepShell>
    </form>
  );
}

export async function StepLifestyle({ answers, basePath }: StepProps) {
  const t = await getTranslations('finder');
  const params = answersToParams(answers);
  params.set('step', '2');

  const groups = [
    {
      name: 'diet',
      label: t('dietLabel'),
      options: DIETS.map((value) => ({
        value,
        label: t(
          value === 'none' ? 'dietNone' : value === 'vegan' ? 'dietVegan' : 'dietVegetarian',
        ),
      })),
      current: answers.diet as string,
    },
    {
      name: 'sleep',
      label: t('sleepLabel'),
      options: SLEEP_LEVELS.map((value) => ({
        value,
        label: t(value === 'good' ? 'sleepGood' : value === 'ok' ? 'sleepOk' : 'sleepPoor'),
      })),
      current: answers.sleep as string,
    },
    {
      name: 'activity',
      label: t('activityLabel'),
      options: ACTIVITY_LEVELS.map((value) => ({
        value,
        label: t(
          value === 'low'
            ? 'activityLow'
            : value === 'moderate'
              ? 'activityModerate'
              : 'activityHigh',
        ),
      })),
      current: answers.activity as string,
    },
  ];

  return (
    <form action={basePath} method="get">
      <input type="hidden" name="step" value="4" />
      <CarriedAnswers answers={answers} omit={['diet', 'sleep', 'activity']} />

      <StepShell
        step={3}
        stepLabel={t('step', { current: 3, total: TOTAL_STEPS })}
        title={t('step3Title')}
        backHref={`${basePath}?${params.toString()}`}
        backLabel={t('back')}
        nextLabel={t('next')}
      >
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <fieldset key={group.name}>
              <legend className="text-sm font-medium text-ink-900">{group.label}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.options.map((option) => (
                  <GoalTile
                    key={option.value}
                    type="radio"
                    name={group.name}
                    value={option.value}
                    label={option.label}
                    checked={group.current === option.value}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </StepShell>
    </form>
  );
}

export async function StepConstraints({ answers, basePath }: StepProps) {
  const t = await getTranslations('finder');
  const params = answersToParams(answers);
  params.set('step', '3');

  return (
    <form action={basePath} method="get">
      <input type="hidden" name="step" value="5" />
      <CarriedAnswers answers={answers} omit={['require', 'form', 'budget']} />

      <StepShell
        step={4}
        stepLabel={t('step', { current: 4, total: TOTAL_STEPS })}
        title={t('step4Title')}
        backHref={`${basePath}?${params.toString()}`}
        backLabel={t('back')}
        nextLabel={t('next')}
      >
        <fieldset>
          <legend className="text-sm font-medium text-ink-900">{t('avoidLabel')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVOIDABLE_TAGS.map((tag) => (
              <GoalTile
                key={tag}
                type="checkbox"
                name="require"
                value={tag}
                label={t(TAG_KEYS[tag] as 'tagGlutenFree')}
                checked={answers.require.includes(tag)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-ink-900">{t('formLabel')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FORMS.map((form) => (
              <GoalTile
                key={form}
                type="radio"
                name="form"
                value={form}
                label={form === 'any' ? t('formAny') : form}
                checked={answers.form === form}
              />
            ))}
          </div>
        </fieldset>

        <div className="mt-6 max-w-xs">
          <label htmlFor="budget" className="block text-sm font-medium text-ink-900">
            {t('budgetLabel')}
          </label>
          <input
            id="budget"
            name="budget"
            type="number"
            min={0}
            step={1}
            defaultValue={answers.budgetCents ? Math.round(answers.budgetCents / 100) : ''}
            className="mt-1 h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900"
            data-numeric
          />
          <p className="mt-1 text-xs text-ink-600">{t('budgetHint')}</p>
        </div>
      </StepShell>
    </form>
  );
}

export async function StepEmail({ answers, basePath }: StepProps) {
  const t = await getTranslations('finder');
  const params = answersToParams(answers);
  params.set('step', '4');

  return (
    /*
     * A POST to a server action, not another GET step. The email must not travel in a query
     * string: a URL lands in browser history, in the `Referer` of every outbound link on the
     * results page, and in any access log on the way. `submitFinder` records the submission and
     * redirects to the results with only the answers.
     */
    <form action={submitFinder}>
      <input type="hidden" name="basePath" value={basePath} />
      <CarriedAnswers answers={answers} omit={[]} />

      <StepShell
        step={5}
        stepLabel={t('step', { current: 5, total: TOTAL_STEPS })}
        title={t('step5Title')}
        hint={t('step5Hint')}
        backHref={`${basePath}?${params.toString()}`}
        backLabel={t('back')}
        nextLabel={t('seeResults')}
      >
        <div className="max-w-sm">
          <label htmlFor="finder-email" className="block text-sm font-medium text-ink-900">
            {t('emailLabel')}
          </label>
          <input
            id="finder-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="mt-1 h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900"
          />
        </div>
      </StepShell>
    </form>
  );
}
