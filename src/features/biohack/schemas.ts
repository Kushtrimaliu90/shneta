import { z } from 'zod';
import {
  ACTIVITY_BANDS,
  AGE_BANDS,
  CAFFEINE,
  DIETS,
  HEIGHT_BANDS,
  LEVELS,
  SEX_BANDS,
  WEIGHT_BANDS,
} from '@/features/biohack/types';

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
  /**
   * Pregnancy and nursing only. Under-18 used to live in this same boolean and now comes from
   * `ageBand` — see `isGated` (docs/15 §9).
   */
  restrictedLifeStage: yesNo,
  medication: yesNo,
  level: z.enum(LEVELS).default('fillestar'),
  budget: z.enum(BUDGET_TIERS).default('any'),

  /**
   * docs/15 §9 — who the customer is.
   *
   * Optional, and that is not laziness. A rule matches only a band it was given, so an omitted
   * answer applies no rule at all — the same conservative direction as declining. It also means a
   * link shared before these questions existed still generates, and the step can be skipped.
   */
  ageBand: z.enum(AGE_BANDS).optional(),
  sex: z.enum(SEX_BANDS).optional(),
  weightBand: z.enum(WEIGHT_BANDS).optional(),
  heightBand: z.enum(HEIGHT_BANDS).optional(),
  activity: z.enum(ACTIVITY_BANDS).optional(),
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
  return protocolAnswersSchema.safeParse({
    ...singles([...form.keys()], (key) => form.get(key)),
    goals: form.getAll('goals').map(String),
  });
}

/** The same, from a URL query — the result page regenerates from these (docs/15 §6). */
export function readAnswerParams(params: URLSearchParams) {
  return protocolAnswersSchema.safeParse({
    ...singles([...params.keys()], (key) => params.get(key)),
    goals: params.getAll('goals'),
  });
}

/**
 * Every non-repeated field, with **empty strings dropped**.
 *
 * The bands are optional enums, and `undefined` is the only value that means "not answered" — an
 * empty string is a validation failure. A form with a disabled control, or a URL carrying `?sex=`
 * because something serialised a blank, would otherwise fail the whole parse and send the customer
 * back to step one over a field they left alone on purpose.
 */
function singles(
  keys: string[],
  read: (key: string) => FormDataEntryValue | string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (key === 'goals') continue;
    const value = read(key);
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

/**
 * docs/15 §1 step 2 / §9 — the hard gate, in one place.
 *
 * Two conditions, and they arrive by different routes on purpose. Under-18 is **derived** from the
 * age band, because age is asked anyway and reading it off that answer is harder to get wrong than
 * a self-declaration buried in a compound yes/no. Pregnancy and nursing can only be declared.
 *
 * Exported so `buildProtocol` and the engine cannot disagree about who is gated — the engine takes
 * a single boolean, and this is the only function that decides it.
 */
export function isGated(answers: ProtocolAnswers): boolean {
  return answers.ageBand === 'nen_18' || answers.restrictedLifeStage;
}

/**
 * Whether the pregnancy question is worth asking.
 *
 * Not asked of someone who has said `mashkull`. It is a question with an obvious answer for them,
 * and a form that asks it anyway reads as one that is not listening — the whole promise of this
 * step being that the shop pays attention to what it was told.
 *
 * Asked of `pa_percaktuar` and of anyone who skipped the question, because there the answer is not
 * obvious and the gate is too important to assume.
 */
export function asksLifeStage(sex: ProtocolAnswers['sex']): boolean {
  return sex !== 'mashkull';
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

  // Omitted rather than written empty: an absent band means "no rule applies", and `?sex=` would
  // round-trip through `readAnswerParams` as a validation failure instead.
  if (answers.ageBand) params.set('ageBand', answers.ageBand);
  if (answers.sex) params.set('sex', answers.sex);
  if (answers.weightBand) params.set('weightBand', answers.weightBand);
  if (answers.heightBand) params.set('heightBand', answers.heightBand);
  if (answers.activity) params.set('activity', answers.activity);

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
