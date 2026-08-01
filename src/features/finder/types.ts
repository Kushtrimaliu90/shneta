/**
 * docs/05 §10 — the supplement finder.
 *
 * The answers live in the **URL**, not in client state. That is what makes "back navigation
 * preserves answers" true rather than aspirational: the browser's back button restores a URL,
 * and the URL *is* the answer set. It also keeps every step a Server Component, so the quiz
 * ships no JavaScript beyond the form controls the browser already has.
 */

export const DIETS = ['none', 'vegan', 'vegetarian'] as const;
export type Diet = (typeof DIETS)[number];

export const SLEEP_LEVELS = ['good', 'ok', 'poor'] as const;
export type SleepLevel = (typeof SLEEP_LEVELS)[number];

export const ACTIVITY_LEVELS = ['low', 'moderate', 'high'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/** The dietary tags the catalogue actually carries — anything else would filter to nothing. */
export const AVOIDABLE_TAGS = ['gluten_free', 'lactose_free', 'sugar_free', 'non_gmo'] as const;
export type AvoidableTag = (typeof AVOIDABLE_TAGS)[number];

export const FORMS = ['any', 'capsule', 'tablet', 'softgel', 'powder', 'liquid', 'gummy'] as const;
export type FormPreference = (typeof FORMS)[number];

export interface FinderAnswers {
  primary: string;
  secondary: string[];
  diet: Diet;
  sleep: SleepLevel;
  activity: ActivityLevel;
  /** Tags the routine must carry — "avoid gluten" means "require gluten_free". */
  require: AvoidableTag[];
  form: FormPreference;
  /** Cents per month, or null for no limit. */
  budgetCents: number | null;
}

export const TOTAL_STEPS = 5;

/**
 * Lifestyle answers become extra goals rather than a separate scoring dimension.
 *
 * "I sleep badly" is, for the purpose of picking supplements, indistinguishable from "one of my
 * goals is sleep" — and modelling it as a goal means it flows through the same +1 as any other
 * secondary rather than needing its own weight nobody can reason about. The mapping is data so
 * it can be read in one glance and changed without touching the algorithm.
 */
export const LIFESTYLE_GOALS: {
  sleep: Partial<Record<SleepLevel, string>>;
  activity: Partial<Record<ActivityLevel, string>>;
} = {
  sleep: { poor: 'gjumi', ok: 'gjumi' },
  activity: { high: 'energji' },
};

export interface ScoredProduct {
  productId: string;
  slug: string;
  score: number;
  /** Why this product is in the routine, as message-key parts the UI localizes. */
  reasons: { kind: 'primary' | 'secondary' | 'rating' | 'fallback'; goalSlug?: string }[];
}
