import { getTranslations } from 'next-intl/server';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { SubmitButton } from '@/components/ui/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { buildProtocol } from '@/features/biohack/actions';
import { asksLifeStage, BUDGET_TIERS, type ProtocolAnswers } from '@/features/biohack/schemas';

/**
 * docs/15 §1 step 2 — the refinements, as one server-rendered form.
 *
 * Radio groups rather than selects or a wizard: six questions, every option visible, no menu to
 * open. The whole step is a Server Component apart from the submit button, so the only JavaScript
 * on the page is the pending state — the answers themselves post as a plain form.
 *
 * Every group carries a `defaultChecked` option, which is what lets `budget` and the two yes/no
 * answers be omitted from the schema's required set: a radio group with no selection sends
 * nothing at all, and "nothing" has to mean the safe default rather than a validation error the
 * customer cannot see the cause of.
 */
export async function RefineForm({
  goals,
  answers,
  locale,
  backHref,
  budgetTiers,
}: {
  goals: string[];
  /** Step 2's answers, carried forward as hidden fields so this step can post the whole set. */
  answers: ProtocolAnswers;
  locale: Locale;
  backHref: string;
  budgetTiers: number[];
}) {
  const t = await getTranslations('biohack');

  const low = budgetTiers[0] ?? 2000;
  const mid = budgetTiers[1] ?? 4000;

  const budgetLabel: Record<(typeof BUDGET_TIERS)[number], string> = {
    any: t('budgetAny'),
    low: t('budgetLow', { amount: formatPrice(low, locale) }),
    mid: t('budgetMid', { from: formatPrice(low, locale), to: formatPrice(mid, locale) }),
    high: t('budgetHigh', { amount: formatPrice(mid, locale) }),
  };

  return (
    <form action={buildProtocol} className="flex flex-col gap-8">
      {goals.map((goal) => (
        <input key={goal} type="hidden" name="goals" value={goal} />
      ))}

      {/*
        Step 2's bands, forwarded.
        Only the ones that were actually answered: an empty `value` would reach the schema as `''`,
        which is a validation failure rather than "not answered" — the distinction `singles()` in
        `schemas.ts` exists to preserve.
      */}
      {answers.ageBand && <input type="hidden" name="ageBand" value={answers.ageBand} />}
      {answers.sex && <input type="hidden" name="sex" value={answers.sex} />}
      {answers.weightBand && <input type="hidden" name="weightBand" value={answers.weightBand} />}
      {answers.heightBand && <input type="hidden" name="heightBand" value={answers.heightBand} />}
      {answers.activity && <input type="hidden" name="activity" value={answers.activity} />}

      <RadioGroup
        name="diet"
        legend={t('dietLabel')}
        options={[
          { value: 'pa_kufizime', label: t('dietNone') },
          { value: 'vegjetarian', label: t('dietVegetarian') },
          { value: 'vegan', label: t('dietVegan') },
        ]}
      />

      <RadioGroup
        name="caffeine"
        legend={t('caffeineLabel')}
        options={[
          { value: 'po', label: t('caffeineYes') },
          { value: 'jo', label: t('caffeineNo') },
          { value: 'vetem_mengjes', label: t('caffeineMorning') },
        ]}
      />

      {/*
       * The gate — pregnancy and nursing only; under-18 now comes from the age band (docs/15 §9).
       *
       * `required` and no default, unlike every other group here: this is the one answer the form
       * must not guess, because `buildProtocol` reads a missing value as "no".
       *
       * **Not asked of someone who answered `mashkull`.** It has an obvious answer for them, and a
       * form that asks anyway reads as one that was not listening — which undermines the whole
       * point of having just asked five questions about who they are. `asksLifeStage` decides, so
       * the rule lives next to `isGated` rather than in the markup.
       */}
      {asksLifeStage(answers.sex) && (
        <RadioGroup
          name="restrictedLifeStage"
          legend={t('lifeStageLabel')}
          hint={t('lifeStageHint')}
          required
          defaultValue={null}
          options={[
            { value: 'po', label: t('yes') },
            { value: 'jo', label: t('no') },
          ]}
        />
      )}

      <RadioGroup
        name="medication"
        legend={t('medicationLabel')}
        hint={t('medicationHint')}
        defaultValue="jo"
        options={[
          { value: 'po', label: t('yes') },
          { value: 'jo', label: t('no') },
        ]}
      />

      <RadioGroup
        name="level"
        legend={t('levelLabel')}
        options={[
          { value: 'fillestar', label: t('levelBeginner'), hint: t('levelBeginnerHint') },
          { value: 'i_avancuar', label: t('levelAdvanced'), hint: t('levelAdvancedHint') },
        ]}
      />

      <RadioGroup
        name="budget"
        legend={t('budgetLabel')}
        options={BUDGET_TIERS.map((tier) => ({ value: tier, label: budgetLabel[tier] }))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="lg" loadingLabel={t('generating')}>
          {t('generate')}
        </SubmitButton>
        <a href={backHref} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {t('back')}
        </a>
      </div>
    </form>
  );
}

interface Option {
  value: string;
  label: string;
  hint?: string;
}

/**
 * A radio group as a `fieldset`/`legend`.
 *
 * The first option is checked unless `defaultValue` says otherwise, and `defaultValue: null`
 * means nothing is checked — the shape the gate needs.
 */
function RadioGroup({
  name,
  legend,
  hint,
  options,
  defaultValue,
  required = false,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: Option[];
  defaultValue?: string | null;
  required?: boolean;
}) {
  const checked = defaultValue === undefined ? options[0]?.value : defaultValue;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-ui text-base font-semibold text-forest-900">
        {legend}
        {required && (
          <span className="ml-0.5 text-error" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {hint && <p className="-mt-1 text-sm text-ink-600">{hint}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex flex-1 cursor-pointer items-start gap-2.5 rounded-md border border-line bg-surface p-3.5 text-sm transition-colors duration-150 ease-[var(--ease-biocode)] hover:border-line-strong focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest-700 has-checked:border-forest-700 has-checked:bg-forest-50"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={checked === option.value}
              required={required}
              className="mt-0.5 size-4 shrink-0 accent-forest-700"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink-900">{option.label}</span>
              {option.hint && <span className="text-ink-600">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
