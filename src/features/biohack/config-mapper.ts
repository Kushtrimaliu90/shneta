import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  ACTIVITY_BANDS,
  AGE_BANDS,
  HEIGHT_BANDS,
  SEX_BANDS,
  WEIGHT_BANDS,
  type EngineSettings,
  type ProfileRule,
  type ProtocolBlock,
  type ProtocolConfig,
  type ProtocolConflict,
  type TimingSlot,
} from '@/features/biohack/types';

/**
 * docs/15 §2 — database rows to engine shapes.
 *
 * Split out of `config-loader.ts` so it is **importable outside a request**. The loader is
 * `server-only` and wraps these in `unstable_cache`, neither of which exists in a Vitest
 * process — and the mapping is exactly the part worth testing against a real database, because
 * every defensive branch here (a goal deleted under a block, a missing `why`, a jsonb pair with
 * one locale) is a shape the type system cannot promise.
 *
 * Takes the client rather than creating one, so the caller decides whether this runs with the
 * service role or a test connection.
 */

interface RawBlock {
  id: string;
  goal_id: string;
  ingredient_id: string | null;
  habit_i18n: unknown;
  weight: number;
  is_core: boolean;
  timing: TimingSlot[];
  phase: number;
  why_i18n: unknown;
  evidence: ProtocolBlock['evidence'];
  caution_i18n: unknown;
  active: boolean;
}

/** A localized jsonb pair, read defensively — a missing locale falls back rather than crashing. */
function pair(value: unknown): { sq: string; en: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sq = typeof record.sq === 'string' ? record.sq : '';
  const en = typeof record.en === 'string' ? record.en : '';
  if (!sq && !en) return null;
  return { sq: sq || en, en: en || sq };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Keeps only the members of a known enum.
 *
 * `when_profile` is jsonb, so nothing at the database level stops someone writing a band the code
 * has never heard of. Dropping it is the right failure: a rule naming an unknown band would match
 * nobody while still reading as active in the admin, which is a rule that lies about itself.
 */
function only<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function readSettings(value: unknown): EngineSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number): number =>
    typeof v[key] === 'number' && Number.isFinite(v[key]) ? (v[key] as number) : fallback;

  return {
    maxItems: num('max_items', 5),
    minItems: num('min_items', 2),
    maxGoals: num('max_goals', 3),
    perGoalCoreGuarantee:
      typeof v.per_goal_core_guarantee === 'boolean' ? v.per_goal_core_guarantee : true,
    durationDays: num('duration_days', 28),
    budgetTiers: Array.isArray(v.budget_tiers)
      ? v.budget_tiers.filter((t): t is number => typeof t === 'number')
      : [2000, 4000],
    subscriptionConvert:
      typeof v.subscription_convert === 'boolean' ? v.subscription_convert : true,
  };
}

/**
 * Reads one config version and flattens it into what the engine takes.
 *
 * `configId` omitted means "the latest approved", which is what the storefront always uses.
 * The simulator passes a draft id — that is the only caller allowed to see an unapproved
 * ruleset, and it is admin-gated.
 */
export async function loadConfig(
  db: SupabaseClient,
  configId?: string,
): Promise<ProtocolConfig | null> {
  const configQuery = db.from('protocol_configs').select('id, version, status').limit(1);

  const { data: configRow } = configId
    ? await configQuery.eq('id', configId).maybeSingle()
    : await configQuery
        .eq('status', 'approved')
        .order('version', { ascending: false })
        .maybeSingle();

  if (!configRow) {
    logger.warn('No protocol config available', { configId: configId ?? 'latest-approved' });
    return null;
  }

  const row = configRow as { id: string; version: number; status: string };

  const [blocks, conflicts, profileRules, goals, ingredients, settings] = await Promise.all([
    db
      .from('protocol_blocks')
      .select(
        'id, goal_id, ingredient_id, habit_i18n, weight, is_core, timing, phase, why_i18n, evidence, caution_i18n, active',
      )
      .eq('config_id', row.id),
    db
      .from('protocol_conflicts')
      .select('id, a_ingredient, b_ingredient, b_goal, kind, rule, note_i18n')
      .eq('config_id', row.id),
    db
      .from('protocol_profile_rules')
      .select(
        'id, ingredient_id, when_profile, effect, reason_i18n, caution_i18n, active, sort_order',
      )
      .eq('config_id', row.id),
    db.from('health_goals').select('id, slug, metrics_i18n'),
    db
      .from('ingredients')
      .select('id, slug, name, med_sensitive, contains_caffeine, scales_with_body_weight'),
    db.from('settings').select('value').eq('key', 'biohack_engine').maybeSingle(),
  ]);

  type GoalRow = { id: string; slug: string; metrics_i18n: unknown };
  type IngredientRow = {
    id: string;
    slug: string;
    name: unknown;
    med_sensitive: boolean;
    contains_caffeine: boolean;
    scales_with_body_weight: boolean;
  };

  const goalById = new Map((goals.data ?? []).map((g) => [g.id, g as GoalRow]));
  const ingredientById = new Map(
    (ingredients.data ?? []).map((i) => [i.id, i as unknown as IngredientRow]),
  );

  const mappedBlocks: ProtocolBlock[] = ((blocks.data ?? []) as unknown as RawBlock[]).flatMap(
    (b) => {
      const goal = goalById.get(b.goal_id);
      const why = pair(b.why_i18n);
      // A block whose goal has been deleted, or which has no PSE copy, cannot be shown to a
      // customer. Dropped rather than rendered blank — the trace would name an item with no
      // reason, which is the one thing this feature promises not to do.
      if (!goal || !why) return [];

      const ingredient = b.ingredient_id ? ingredientById.get(b.ingredient_id) : undefined;
      const habit = pair(b.habit_i18n);
      if (!ingredient && !habit) return [];

      return [
        {
          id: b.id,
          goalSlug: goal.slug,
          ingredientSlug: ingredient?.slug ?? null,
          ingredientName: ingredient ? pair(ingredient.name) : null,
          habit,
          weight: b.weight,
          isCore: b.is_core,
          timing: b.timing,
          phase: b.phase === 2 ? 2 : 1,
          why,
          evidence: b.evidence,
          caution: pair(b.caution_i18n),
          active: b.active,
          medSensitive: ingredient?.med_sensitive ?? false,
          containsCaffeine: ingredient?.contains_caffeine ?? false,
        },
      ];
    },
  );

  type RawConflict = {
    id: string;
    a_ingredient: string | null;
    b_ingredient: string | null;
    b_goal: string | null;
    kind: ProtocolConflict['kind'];
    rule: unknown;
    note_i18n: unknown;
  };

  const mappedConflicts: ProtocolConflict[] = (
    (conflicts.data ?? []) as unknown as RawConflict[]
  ).map((c) => {
    const rule = (c.rule ?? {}) as Record<string, unknown>;
    return {
      id: c.id,
      aIngredientSlug: c.a_ingredient ? (ingredientById.get(c.a_ingredient)?.slug ?? null) : null,
      bIngredientSlug: c.b_ingredient ? (ingredientById.get(c.b_ingredient)?.slug ?? null) : null,
      bGoalSlug: c.b_goal ? (goalById.get(c.b_goal)?.slug ?? null) : null,
      kind: c.kind,
      rule: {
        allowedSlots: stringList(rule.allowed_slots) as TimingSlot[],
        separateSlots: rule.separate_slots === true,
      },
      note: pair(c.note_i18n),
    };
  });

  /**
   * docs/15 §9 — profile rules.
   *
   * Every list in `when_profile` is read through `stringList` and then narrowed against the enum
   * constants, so an unknown band written by hand into the jsonb is dropped rather than carried
   * into the engine. A rule that mentions a band the code does not know would otherwise match
   * nobody while looking active in the admin, which is the worst of both.
   */
  type RawRule = {
    id: string;
    ingredient_id: string | null;
    when_profile: unknown;
    effect: unknown;
    reason_i18n: unknown;
    caution_i18n: unknown;
    active: boolean;
    sort_order: number;
  };

  const mappedRules: ProfileRule[] = ((profileRules.data ?? []) as unknown as RawRule[]).map(
    (r) => {
      const when = (r.when_profile ?? {}) as Record<string, unknown>;
      const effect = (r.effect ?? {}) as Record<string, unknown>;
      const ingredient = r.ingredient_id ? ingredientById.get(r.ingredient_id) : undefined;

      const delta = effect.weight_delta;

      return {
        id: r.id,
        ingredientSlug: ingredient?.slug ?? null,
        ingredientName: ingredient ? pair(ingredient.name) : null,
        when: {
          ageBands: only(stringList(when.age_bands), AGE_BANDS),
          sexes: only(stringList(when.sexes), SEX_BANDS),
          weightBands: only(stringList(when.weight_bands), WEIGHT_BANDS),
          heightBands: only(stringList(when.height_bands), HEIGHT_BANDS),
          activity: only(stringList(when.activity), ACTIVITY_BANDS),
          goals: stringList(when.goals),
        },
        effect: {
          // Rounded and clamped: the column is jsonb, so nothing stops `1e9` or `"20"` being
          // written into it, and a score is a small integer.
          ...(typeof delta === 'number' && Number.isFinite(delta) && delta !== 0
            ? { weightDelta: Math.max(-100, Math.min(100, Math.round(delta))) }
            : {}),
          ...(effect.exclude === true ? { exclude: true } : {}),
          ...(effect.require === true ? { require: true } : {}),
          ...(effect.servings_hint === true ? { servingsHint: true } : {}),
        },
        reason: pair(r.reason_i18n) ?? { sq: '', en: '' },
        caution: pair(r.caution_i18n),
        active: r.active,
        sortOrder: r.sort_order,
      };
    },
  );

  const metrics: ProtocolConfig['metrics'] = {};
  for (const goal of goalById.values()) {
    const raw = goal.metrics_i18n;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    metrics[goal.slug] = { sq: stringList(record.sq), en: stringList(record.en) };
  }

  return {
    version: row.version,
    blocks: mappedBlocks,
    conflicts: mappedConflicts,
    profileRules: mappedRules,
    settings: readSettings((settings.data as { value: unknown } | null)?.value),
    metrics,
  };
}
