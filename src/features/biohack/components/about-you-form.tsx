import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import {
  ACTIVITY_BANDS,
  AGE_BANDS,
  HEIGHT_BANDS,
  SEX_BANDS,
  WEIGHT_BANDS,
  type ActivityBand,
  type AgeBand,
  type HeightBand,
  type SexBand,
  type WeightBand,
} from '@/features/biohack/types';
import type { ProtocolAnswers } from '@/features/biohack/schemas';

/**
 * docs/15 §9 — step 2, "about you".
 *
 * A `GET` form, like step 1, so the answers land in the URL and the back button keeps working with
 * no client state. Every control is a radio group of bands: five taps, no keyboards, which is what
 * keeps five extra questions inside the sixty seconds docs/15 §1 asks for.
 *
 * **Nothing here is required.** A band that is not answered applies no rule, which is the same
 * conservative direction as declining — so "Vazhdo" works with the whole step untouched and the
 * customer gets the unpersonalised protocol rather than a validation error. The one answer that
 * *is* consequential, age, says why it is being asked.
 */
export async function AboutYouForm({
  goals,
  answers,
  action,
  backHref,
}: {
  goals: string[];
  answers: ProtocolAnswers;
  action: string;
  backHref: string;
}) {
  const t = await getTranslations('biohack');

  const ageLabel: Record<AgeBand, string> = {
    nen_18: t('ageUnder18'),
    '18_29': '18–29',
    '30_39': '30–39',
    '40_49': '40–49',
    '50_64': '50–64',
    '65_plus': t('age65Plus'),
  };

  const sexLabel: Record<SexBand, string> = {
    femer: t('sexFemale'),
    mashkull: t('sexMale'),
    pa_percaktuar: t('sexUnspecified'),
  };

  const weightLabel: Record<WeightBand, string> = {
    nen_60: t('weightUnder', { kg: 60 }),
    '60_74': '60–74 kg',
    '75_89': '75–89 kg',
    '90_104': '90–104 kg',
    '105_plus': t('weightOver', { kg: 105 }),
  };

  const heightLabel: Record<HeightBand, string> = {
    nen_160: t('heightUnder', { cm: 160 }),
    '160_169': '160–169 cm',
    '170_179': '170–179 cm',
    '180_189': '180–189 cm',
    '190_plus': t('heightOver', { cm: 190 }),
  };

  const activityLabel: Record<ActivityBand, string> = {
    ulur: t('activitySedentary'),
    i_lehte: t('activityLight'),
    i_rregullt: t('activityRegular'),
    intensiv: t('activityIntense'),
  };

  const activityHint: Record<ActivityBand, string> = {
    ulur: t('activitySedentaryHint'),
    i_lehte: t('activityLightHint'),
    i_rregullt: t('activityRegularHint'),
    intensiv: t('activityIntenseHint'),
  };

  return (
    <form action={action} method="get" className="flex flex-col gap-8">
      <input type="hidden" name="step" value="3" />
      {goals.map((goal) => (
        <input key={goal} type="hidden" name="goals" value={goal} />
      ))}

      {/*
        Age carries its own note, and it is the only one that does.
        It is the answer with a consequence the customer cannot see coming — under 18 ends the flow
        — and a form that gates somebody on an answer it did not explain is a form that ambushed
        them.
      */}
      <Bands
        name="ageBand"
        legend={t('ageLabel')}
        hint={t('ageHint')}
        options={AGE_BANDS.map((band) => ({ value: band, label: ageLabel[band] }))}
        selected={answers.ageBand}
      />

      <Bands
        name="sex"
        legend={t('sexLabel')}
        hint={t('sexHint')}
        options={SEX_BANDS.map((band) => ({ value: band, label: sexLabel[band] }))}
        selected={answers.sex}
      />

      <Bands
        name="weightBand"
        legend={t('weightLabel')}
        options={WEIGHT_BANDS.map((band) => ({ value: band, label: weightLabel[band] }))}
        selected={answers.weightBand}
      />

      <Bands
        name="heightBand"
        legend={t('heightLabel')}
        options={HEIGHT_BANDS.map((band) => ({ value: band, label: heightLabel[band] }))}
        selected={answers.heightBand}
      />

      <Bands
        name="activity"
        legend={t('activityLabel')}
        options={ACTIVITY_BANDS.map((band) => ({
          value: band,
          label: activityLabel[band],
          hint: activityHint[band],
        }))}
        selected={answers.activity}
      />

      <p className="text-xs text-ink-500">{t('aboutYouPrivacy')}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonVariants({ size: 'lg' })}>
          {t('next')}
        </button>
        <a href={backHref} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {t('back')}
        </a>
      </div>
    </form>
  );
}

/**
 * A band picker: one radio group, wrapping on narrow screens.
 *
 * No option is pre-selected unless the customer already chose one, so "unanswered" is a state the
 * markup can actually express — `defaultChecked` on the first band would turn every skipped
 * question into a confident wrong answer.
 */
function Bands({
  name,
  legend,
  hint,
  options,
  selected,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: { value: string; label: string; hint?: string }[];
  selected: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-ui text-base font-semibold text-forest-900">{legend}</legend>
      {hint && <p className="-mt-1 text-sm text-ink-600">{hint}</p>}

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          /*
           * The hint is a **description**, not part of the name.
           *
           * Wrapping both in the `<label>` makes the accessible name "Intense 5+ times a week, or
           * competitive sport" — one string, so anything selecting the control by its visible
           * label misses, which is how the E2E found this. `aria-describedby` keeps the hint
           * announced after the name instead of glued into it, which is also what a screen-reader
           * user wants: the choice first, the elaboration second.
           */
          const hintId = option.hint ? `${name}-${option.value}-hint` : undefined;

          return (
            <label
              key={option.value}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm transition-colors duration-150 ease-[var(--ease-biocode)] hover:border-line-strong focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest-700 has-checked:border-forest-700 has-checked:bg-forest-50"
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  defaultChecked={selected === option.value}
                  aria-label={option.label}
                  aria-describedby={hintId}
                  className="size-4 shrink-0 accent-forest-700"
                />
                <span className="font-medium text-ink-900" data-numeric>
                  {option.label}
                </span>
              </span>
              {option.hint && (
                <span id={hintId} className="pl-6 text-xs text-ink-600">
                  {option.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
