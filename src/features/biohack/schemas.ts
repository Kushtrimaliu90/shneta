import { z } from 'zod';
import { CAFFEINE, DIETS, LEVELS } from '@/features/biohack/types';

/**
 * docs/15 §1 — the answers, as the wire sees them.
 *
 * The three steps are a plain form posted to a server action, so everything arrives as a string.
 * Coercion lives here rather than in the action: the action's job is to decide, not to parse, and
 * a schema is the only place the shape is stated once for the form, the URL and the stored
 * `inputs` jsonb alike.
 */

/** A slug from `health_goals`. Existence is proved by the config, not by a regex. */
const goalSlug = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'invalid');

/**
 * `budget` is a tier label, not free-typed money.
 *
 * docs/15 §1 offers three choices and §2 stores the boundaries in
 * `settings.biohack_engine.budget_tiers`. Sending the label keeps the two in step: change a tier
 * in settings and the same three radio buttons mean the new numbers, with no client to redeploy.
 */
export const BUDGET_TIERS = ['any', 'low', 'mid', 'high'] as const;
export type BudgetTier = (typeof BUDGET_TIERS)[number];

/**
 * A yes/no answer as it leaves a radio group.
 *
 * Unchecked radios are absent from the FormData entirely, so `undefined` has to mean something.
 * It means "no" for every question here — and for the life-stage gate that is the safe reading
 * only because the field is `required` in the markup and the step cannot advance without it.
 */
const yesNo = z
  .union([z.literal('po'), z.literal('jo')])
  .optional()
  .transform((value) => value === 'po');

export const protocolAnswersSchema = z.object({
  goals: z.array(goalSlug).min(1, 'atLeastOne').max(3, 'tooMany'),
  diet: z.enum(DIETS).default('pa_kufizime'),
  caffeine: z.enum(CAFFEINE).default('po'),
  restrictedLifeStage: yesNo,
  medication: yesNo,
  level: z.enum(LEVELS).default('fillestar'),
  budget: z.enum(BUDGET_TIERS).default('any'),
});

export type ProtocolAnswers = z.infer<typeof protocolAnswersSchema>;

/**
 * Parses the answers out of a `FormData` or a `URLSearchParams`-shaped record.
 *
 * `goals` is the reason this exists. It is repeated — one entry per selected tile — and
 * `Object.fromEntries` keeps only the last, which is exactly the bug that silently reduced five
 * related products to one in the admin picker (docs/13 §Q3). `getAll` is the whole fix.
 */
export function readAnswerForm(form: FormData) {
  const single = Object.fromEntries(
    [...form.keys()].filter((key) => key !== 'goals').map((key) => [key, form.get(key)]),
  );
  return protocolAnswersSchema.safeParse({
    ...single,
    goals: form.getAll('goals').map(String),
  });
}

/** The same, from a URL query — the result page regenerates from these (docs/15 §6). */
export function readAnswerParams(params: URLSearchParams) {
  const single = Object.fromEntries(
    [...params.keys()].filter((key) => key !== 'goals').map((key) => [key, params.get(key)]),
  );
  return protocolAnswersSchema.safeParse({ ...single, goals: params.getAll('goals') });
}

/** Answers → query string, stable order, so the same answers always produce the same URL. */
export function answersToParams(answers: ProtocolAnswers): URLSearchParams {
  const params = new URLSearchParams();
  for (const goal of answers.goals) params.append('goals', goal);
  params.set('diet', answers.diet);
  params.set('caffeine', answers.caffeine);
  params.set('restrictedLifeStage', answers.restrictedLifeStage ? 'po' : 'jo');
  params.set('medication', answers.medication ? 'po' : 'jo');
  params.set('level', answers.level);
  params.set('budget', answers.budget);
  return params;
}

/**
 * Tier label → a ceiling in cents, read from the engine settings.
 *
 * `budget_tiers` is a list of boundaries: `[2000, 4000]` means under €20, €20–40, and over €40.
 * "high" is not a ceiling at all — a customer saying they will spend more than €40 has not set a
 * limit — so it maps to null, the same as "any".
 */
export function budgetCeilingCents(tier: BudgetTier, tiers: number[]): number | null {
  if (tier === 'low') return tiers[0] ?? null;
  if (tier === 'mid') return tiers[1] ?? null;
  return null;
}
