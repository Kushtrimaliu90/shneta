import type { Database } from '@/lib/supabase/database.types';

/**
 * docs/15 — the BioHack Protocol Generator.
 *
 * Every type here is what the **engine** works with, which is deliberately not what the database
 * returns. The engine is a pure function (docs/15 §3) and its inputs are plain data with no
 * Supabase shapes, no jsonb and no nullable columns to re-check — the loader does that once, and
 * the engine can then be tested against hand-written fixtures rather than a database.
 */

export type TimingSlot = Database['public']['Enums']['timing_slot'];
export type ConflictKind = Database['public']['Enums']['conflict_kind'];
export type EvidenceLevel = Database['public']['Enums']['evidence_level'];

export const TIMING_SLOTS = [
  'mengjes',
  'dite',
  'mbremje',
  'para_gjumit',
  'me_ushqim',
  'para_stervitjes',
] as const satisfies readonly TimingSlot[];

/** The three day-parts the result timeline groups into (docs/15 §1 step 3). */
export const DAY_PARTS = ['mengjes', 'dite', 'mbremje'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/**
 * Where a slot appears on the timeline.
 *
 * Six slots, three columns: `me_ushqim` ("with food") and `para_stervitjes` ("pre-workout") are
 * instructions rather than times of day, and putting them in their own columns would produce a
 * timeline with two headings nobody can place in a morning. They fold into the day-part a person
 * would actually do them in, and the slot itself is still shown on the card as the instruction.
 */
export const SLOT_DAY_PART: Record<TimingSlot, DayPart> = {
  mengjes: 'mengjes',
  me_ushqim: 'dite',
  dite: 'dite',
  para_stervitjes: 'dite',
  mbremje: 'mbremje',
  para_gjumit: 'mbremje',
};

// ── Answers ──────────────────────────────────────────────────────────────────

export const DIETS = ['pa_kufizime', 'vegjetarian', 'vegan'] as const;
export type Diet = (typeof DIETS)[number];

export const CAFFEINE = ['po', 'jo', 'vetem_mengjes'] as const;
export type Caffeine = (typeof CAFFEINE)[number];

export const LEVELS = ['fillestar', 'i_avancuar'] as const;
export type Level = (typeof LEVELS)[number];

// ── Who the customer is (docs/15 §9) ─────────────────────────────────────────

/**
 * Bands, never exact values.
 *
 * They answer every question a rule needs to ask, they are five taps rather than five keyboards
 * — which is what keeps the flow inside the sixty seconds docs/15 §1 asks for — and a shop that
 * sells magnesium has no business storing somebody's exact weight and date of birth.
 */
export type AgeBand = Database['public']['Enums']['age_band'];
export type SexBand = Database['public']['Enums']['sex_band'];
export type WeightBand = Database['public']['Enums']['weight_band'];
export type HeightBand = Database['public']['Enums']['height_band'];
export type ActivityBand = Database['public']['Enums']['activity_band'];

export const AGE_BANDS = [
  'nen_18',
  '18_29',
  '30_39',
  '40_49',
  '50_64',
  '65_plus',
] as const satisfies readonly AgeBand[];

export const SEX_BANDS = [
  'femer',
  'mashkull',
  'pa_percaktuar',
] as const satisfies readonly SexBand[];

export const WEIGHT_BANDS = [
  'nen_60',
  '60_74',
  '75_89',
  '90_104',
  '105_plus',
] as const satisfies readonly WeightBand[];

export const HEIGHT_BANDS = [
  'nen_160',
  '160_169',
  '170_179',
  '180_189',
  '190_plus',
] as const satisfies readonly HeightBand[];

export const ACTIVITY_BANDS = [
  'ulur',
  'i_lehte',
  'i_rregullt',
  'intensiv',
] as const satisfies readonly ActivityBand[];

/**
 * How many label servings a body-weight-scaled ingredient suggests.
 *
 * A **multiplier on the manufacturer's serving**, never a dose in grams. Protein and creatine are
 * the two ingredients in this catalogue whose sensible intake tracks body mass, and the honest
 * way to reflect that is "at your weight, two of the servings on the label" — the label stays the
 * authority, which is where docs/08 §7 requires it to stay.
 *
 * Ordered by band so the table reads as the ramp it is.
 */
export const SERVINGS_BY_WEIGHT: Record<WeightBand, number> = {
  nen_60: 1,
  '60_74': 1,
  '75_89': 2,
  '90_104': 2,
  '105_plus': 3,
};

/** docs/15 §2 — `budget_tiers` in cents. `null` is "no limit", not "cheapest". */
export type BudgetCents = number | null;

export interface ProtocolInputs {
  /** 1–3 health-goal slugs, in the order chosen. */
  goals: string[];
  diet: Diet;
  caffeine: Caffeine;
  /**
   * The hard gate: pregnant or nursing.
   *
   * Under-18 used to live in this same boolean and now comes from `ageBand`. Three unrelated
   * questions behind one yes/no meant the one that mattered most was the easiest to answer
   * carelessly — and age is asked anyway, so reading the gate off it is both shorter and harder
   * to get wrong (docs/15 §9).
   */
  restrictedLifeStage: boolean;
  medication: boolean;
  level: Level;
  budgetCents: BudgetCents;

  /**
   * Who the customer is. Optional so a stored protocol from before this existed still replays:
   * `generated_protocols` keeps the inputs verbatim, and those rows have none of these fields.
   * A missing band matches no rule, which is the same conservative direction as declining to say.
   */
  ageBand?: AgeBand;
  sex?: SexBand;
  weightBand?: WeightBand;
  heightBand?: HeightBand;
  activity?: ActivityBand;
}

// ── The ruleset, flattened ───────────────────────────────────────────────────

export interface ProtocolBlock {
  id: string;
  goalSlug: string;
  /** Null for a habit. */
  ingredientSlug: string | null;
  ingredientName: { sq: string; en: string } | null;
  habit: { sq: string; en: string } | null;
  weight: number;
  isCore: boolean;
  timing: TimingSlot[];
  phase: 1 | 2;
  why: { sq: string; en: string };
  evidence: EvidenceLevel | null;
  caution: { sq: string; en: string } | null;
  /**
   * Carried into the engine rather than filtered out by the loader.
   *
   * The simulator loads a whole draft config to show what it contains, including the blocks an
   * editor has switched off, and the engine must still ignore those. Filtering in one place —
   * the engine — means the simulator and the storefront cannot disagree about what "active" does.
   */
  active: boolean;
  /** Denormalised from `ingredients` so the engine needs no second lookup. */
  medSensitive: boolean;
  containsCaffeine: boolean;
}

export interface ProtocolConflict {
  id: string;
  aIngredientSlug: string | null;
  bIngredientSlug: string | null;
  bGoalSlug: string | null;
  kind: ConflictKind;
  rule: { allowedSlots?: TimingSlot[]; separateSlots?: boolean };
  note: { sq: string; en: string } | null;
}

/**
 * docs/15 §9 — one personalisation rule, as the engine sees it.
 *
 * The engine knows how to *evaluate* these and knows none of them. That split is the whole point:
 * "over 50 needs more B12" is nutrition knowledge belonging to the product manager, and a rule in
 * a table is something they can read, change and send for approval. The same rule as an `if` in
 * this file would be invisible to them forever.
 */
export interface ProfileRule {
  id: string;
  /** Null applies the rule to every candidate — only sensible with a narrow `when`. */
  ingredientSlug: string | null;
  ingredientName: { sq: string; en: string } | null;
  /** Every listed dimension must match. An empty list for a dimension means "don't care". */
  when: {
    ageBands: AgeBand[];
    sexes: SexBand[];
    weightBands: WeightBand[];
    heightBands: HeightBand[];
    activity: ActivityBand[];
    /** Only fire when one of these goals was chosen. */
    goals: string[];
  };
  effect: {
    /** Added to the candidate's score. Negative demotes without removing. */
    weightDelta?: number;
    exclude?: boolean;
    /** Guarantee a place in the result, ahead of the global score fill. */
    require?: boolean;
    /** Ask the result page for a body-weight serving note (see `SERVINGS_BY_WEIGHT`). */
    servingsHint?: boolean;
  };
  /** The sentence the customer reads when this rule changed their protocol. */
  reason: { sq: string; en: string };
  caution: { sq: string; en: string } | null;
  active: boolean;
  sortOrder: number;
}

export interface EngineSettings {
  maxItems: number;
  minItems: number;
  maxGoals: number;
  perGoalCoreGuarantee: boolean;
  durationDays: number;
  budgetTiers: number[];
  subscriptionConvert: boolean;
}

export interface ProtocolConfig {
  version: number;
  blocks: ProtocolBlock[];
  conflicts: ProtocolConflict[];
  profileRules: ProfileRule[];
  settings: EngineSettings;
  /** Metric templates per goal slug, for the "what to measure" card. */
  metrics: Record<string, { sq: string[]; en: string[] }>;
}

// ── The catalogue the engine resolves against ────────────────────────────────

/**
 * One purchasable option for an ingredient.
 *
 * `pricePerServingCents` is what the ranking sorts on rather than `priceCents`: a 120-capsule tub
 * at €22 is cheaper per day than a 30-capsule box at €9, and recommending the box because its
 * sticker is smaller would be wrong in exactly the way a customer notices a month later.
 */
export interface CatalogProduct {
  productId: string;
  slug: string;
  variantId: string;
  ingredientSlugs: string[];
  dietaryTags: string[];
  priceCents: number;
  pricePerServingCents: number;
  ratingAvg: number;
  isFeatured: boolean;
  inStock: boolean;
}

// ── The result ───────────────────────────────────────────────────────────────

export type TraceKind =
  | 'candidate'
  | 'synergy'
  | 'profile_boost'
  | 'profile_demote'
  | 'profile_excluded'
  | 'profile_required'
  | 'excluded_medication'
  | 'excluded_caffeine'
  | 'excluded_diet'
  | 'excluded_conflict'
  | 'timing_constrained'
  | 'caution_attached'
  | 'core_guaranteed'
  | 'budget_cut'
  | 'no_stock'
  | 'phase_deferred';

/**
 * One decision, as data rather than as a sentence.
 *
 * docs/15 §3.9 wants the trace rendered in both locales and verbatim in the admin simulator. If
 * the engine produced prose it would have to produce it twice and the simulator would show a
 * translation rather than the reasoning. So it emits a kind plus its subjects, and the UI writes
 * the sentence — which also means adding a locale later costs nothing here.
 */
export interface TraceEntry {
  kind: TraceKind;
  /** Ingredient slug, habit key, or goal slug — whatever the entry is about. */
  subject: string;
  /** The other side of a conflict, or the goal a score came from. */
  object?: string;
  score?: number;
  detail?: string;
}

export interface ProtocolItem {
  kind: 'supplement' | 'habit';
  /** Stable key: ingredient slug, or a normalised habit key. */
  key: string;
  name: { sq: string; en: string };
  why: { sq: string; en: string };
  /** Which of the customer's goals this item earned its place from. */
  goalSlugs: string[];
  timing: TimingSlot[];
  phase: 1 | 2;
  evidence: EvidenceLevel | null;
  caution: { sq: string; en: string } | null;
  score: number;
  /** Absent for habits, and for a supplement with nothing purchasable behind it. */
  product: {
    productId: string;
    slug: string;
    variantId: string;
    priceCents: number;
  } | null;
  /** True when the ingredient is right but nothing is in stock (docs/15 §3.8). */
  comingSoon: boolean;

  /**
   * The personalisation reasons that touched this item, in the order they applied.
   *
   * Shown on the card beneath the PSE line, which is the difference between a protocol that is
   * personalised and one that merely *is* personalised without saying so. Empty for an item no
   * profile rule affected.
   */
  profileReasons: { sq: string; en: string }[];

  /**
   * Label servings a body-weight-scaled ingredient suggests — a multiplier on the manufacturer's
   * serving, never a dose. Null unless a rule asked for it and a weight band was given.
   */
  servingsHint: number | null;
}

export interface ProtocolResult {
  gated: boolean;
  goalSlugs: string[];
  durationDays: number;
  phased: boolean;
  items: ProtocolItem[];
  /**
   * Ranked, resolved candidates that did not make the cut — the pool "Ndërro" swaps from.
   *
   * A flat pool rather than a list hanging off each item, because most alternates serve more than
   * one of the chosen goals and per-item lists would ship the same object several times. The UI
   * picks the best alternate sharing a goal with the item being replaced.
   *
   * Carried in the payload so a swap costs no round trip and a stored protocol can still be
   * modified when it is reopened.
   */
  alternates: ProtocolItem[];
  /** Metric templates for the chosen goals, deduplicated, in goal order. */
  metrics: { sq: string[]; en: string[] };
  monthlyTotalCents: number;
  trace: TraceEntry[];
  configVersion: number;
  /** Always true. Present in the payload so a stored result carries its own obligation. */
  disclaimer: true;
  /** Set when the medication answer was yes — the result page shows a standing banner. */
  medicationCaution: boolean;
}
