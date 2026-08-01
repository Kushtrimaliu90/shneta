import {
  ACTIVITY_LEVELS,
  AVOIDABLE_TAGS,
  DIETS,
  FORMS,
  SLEEP_LEVELS,
  type ActivityLevel,
  type AvoidableTag,
  type Diet,
  type FinderAnswers,
  type FormPreference,
  type SleepLevel,
} from '@/features/finder/types';

/**
 * The URL ⇄ answers boundary.
 *
 * Every value is validated on the way in, because these arrive from an address bar: an unknown
 * diet must fall back to "none" rather than filtering the whole catalogue away, and an
 * unparseable budget must mean "no budget" rather than zero. A quiz that returns nothing because
 * somebody edited the URL looks broken, not strict.
 */

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | undefined {
  const raw = Array.isArray(params[key]) ? params[key][0] : params[key];
  return raw?.trim() || undefined;
}

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
}

export function readAnswers(params: Params): FinderAnswers {
  return {
    primary: one(params, 'primary') ?? '',
    // docs/05 §10 caps the secondaries at two — enforced here, not only in the UI, because the
    // UI is a set of checkboxes and the URL is not.
    secondary: list(one(params, 'secondary')).slice(0, 2),
    diet: pick<Diet>(one(params, 'diet'), DIETS, 'none'),
    sleep: pick<SleepLevel>(one(params, 'sleep'), SLEEP_LEVELS, 'ok'),
    activity: pick<ActivityLevel>(one(params, 'activity'), ACTIVITY_LEVELS, 'moderate'),
    require: list(one(params, 'require')).filter((tag): tag is AvoidableTag =>
      (AVOIDABLE_TAGS as readonly string[]).includes(tag),
    ),
    form: pick<FormPreference>(one(params, 'form'), FORMS, 'any'),
    budgetCents: readBudget(one(params, 'budget')),
  };
}

/** Euros in the URL, cents in the answers. `0` and nonsense both mean "no limit". */
function readBudget(value: string | undefined): number | null {
  if (!value) return null;
  const euros = Number(value);
  if (!Number.isFinite(euros) || euros <= 0) return null;
  return Math.round(euros * 100);
}

export function readStep(params: Params): number {
  const raw = Number(one(params, 'step') ?? 1);
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return Math.min(raw, 6);
}

/** Answers → query string, so a step form can carry everything answered so far. */
export function answersToParams(answers: FinderAnswers): URLSearchParams {
  const params = new URLSearchParams();
  if (answers.primary) params.set('primary', answers.primary);
  if (answers.secondary.length) params.set('secondary', answers.secondary.join(','));
  if (answers.diet !== 'none') params.set('diet', answers.diet);
  if (answers.sleep !== 'ok') params.set('sleep', answers.sleep);
  if (answers.activity !== 'moderate') params.set('activity', answers.activity);
  if (answers.require.length) params.set('require', answers.require.join(','));
  if (answers.form !== 'any') params.set('form', answers.form);
  if (answers.budgetCents) params.set('budget', String(Math.round(answers.budgetCents / 100)));
  return params;
}
