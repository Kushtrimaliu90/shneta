import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { asLocalizedField, pickLocale, type LocalizedField } from '@/lib/i18n';
import { loadConfig } from '@/features/biohack/config-mapper';
import type { ProtocolConfig, TimingSlot } from '@/features/biohack/types';

/**
 * docs/15 §4 — the reads behind `/admin/biohack`.
 *
 * Through the **SSR client**, not the service client the storefront loader uses. The config
 * tables carry staff-read policies precisely so this screen can exist under RLS; reaching for
 * the service role here would work and would mean a bug in the page could show a draft to
 * someone whose role does not allow it. The storefront reads with the service role because its
 * caller is an anonymous visitor, which is a different problem with a different answer.
 */

export type ConfigStatus = 'draft' | 'pending_review' | 'approved' | 'archived';

export interface ConfigSummary {
  id: string;
  version: number;
  status: ConfigStatus;
  notes: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  blockCount: number;
  conflictCount: number;
}

/** Every version, newest first — the Versions tab and the tab bar's status chip. */
export async function listConfigs(): Promise<ConfigSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('protocol_configs')
    .select(
      `id, version, status, notes, created_at, approved_at,
       approver:profiles!protocol_configs_approved_by_fkey ( full_name, email ),
       protocol_blocks ( id ),
       protocol_conflicts ( id )`,
    )
    .order('version', { ascending: false });

  if (error) {
    logger.error('listConfigs failed', { cause: error.message });
    return [];
  }

  type Raw = {
    id: string;
    version: number;
    status: string;
    notes: string | null;
    created_at: string;
    approved_at: string | null;
    approver: { full_name: string | null; email: string } | null;
    protocol_blocks: { id: string }[];
    protocol_conflicts: { id: string }[];
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status as ConfigStatus,
    notes: row.notes,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    approvedByName: row.approver?.full_name ?? row.approver?.email ?? null,
    blockCount: row.protocol_blocks.length,
    conflictCount: row.protocol_conflicts.length,
  }));
}

/**
 * The version the admin screen is working on.
 *
 * The newest non-archived draft or pending version if there is one, otherwise the approved
 * version. That ordering is what makes the screen do the obvious thing: once someone starts a
 * draft, every tab shows the draft; until then, everything shows what is live.
 */
export async function currentConfigId(): Promise<string | null> {
  const configs = await listConfigs();
  const editable = configs.find((c) => c.status === 'draft' || c.status === 'pending_review');
  return (editable ?? configs.find((c) => c.status === 'approved'))?.id ?? null;
}

/** The engine-shaped config for one version — what the simulator runs. */
export async function readAdminConfig(configId: string): Promise<ProtocolConfig | null> {
  return loadConfig(await createClient(), configId);
}

// ── The matrix, in editor shape ──────────────────────────────────────────────

export interface BlockRow {
  id: string;
  goalId: string;
  goalSlug: string;
  goalName: string;
  ingredientId: string | null;
  ingredientName: string | null;
  habit: { sq: string; en: string } | null;
  weight: number;
  isCore: boolean;
  timing: TimingSlot[];
  phase: number;
  why: { sq: string; en: string };
  caution: { sq: string; en: string } | null;
  evidence: string | null;
  active: boolean;
}

/** The blocks of one config for one goal, heaviest first — the Matrix tab's list. */
export async function listBlocks(configId: string, goalSlug?: string): Promise<BlockRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('protocol_blocks')
    .select(
      `id, goal_id, ingredient_id, habit_i18n, weight, is_core, timing, phase,
       why_i18n, caution_i18n, evidence, active,
       health_goals ( slug, name ),
       ingredients ( name )`,
    )
    .eq('config_id', configId)
    .order('weight', { ascending: false });

  if (error) {
    logger.error('listBlocks failed', { cause: error.message });
    return [];
  }

  type Raw = {
    id: string;
    goal_id: string;
    ingredient_id: string | null;
    habit_i18n: unknown;
    weight: number;
    is_core: boolean;
    timing: TimingSlot[];
    phase: number;
    why_i18n: unknown;
    caution_i18n: unknown;
    evidence: string | null;
    active: boolean;
    health_goals: { slug: string; name: unknown } | null;
    ingredients: { name: unknown } | null;
  };

  const rows = ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    goalId: row.goal_id,
    goalSlug: row.health_goals?.slug ?? '',
    // English throughout: the admin panel is English-only in v1 (docs/01 §3).
    goalName: pickLocale(asLocalizedField(row.health_goals?.name), 'en'),
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredients ? pickLocale(asLocalizedField(row.ingredients.name), 'en') : null,
    habit: pair(row.habit_i18n),
    weight: row.weight,
    isCore: row.is_core,
    timing: row.timing,
    phase: row.phase,
    why: pair(row.why_i18n) ?? { sq: '', en: '' },
    caution: pair(row.caution_i18n),
    evidence: row.evidence,
    active: row.active,
  }));

  return goalSlug ? rows.filter((row) => row.goalSlug === goalSlug) : rows;
}

export interface ConflictRow {
  id: string;
  aName: string;
  aSlug: string | null;
  bName: string | null;
  bIsGoal: boolean;
  kind: string;
  rule: Record<string, unknown>;
  note: { sq: string; en: string } | null;
}

/** The Conflicts tab. */
export async function listConflicts(configId: string): Promise<ConflictRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('protocol_conflicts')
    .select(
      `id, kind, rule, note_i18n,
       a:ingredients!protocol_conflicts_a_ingredient_fkey ( slug, name ),
       b:ingredients!protocol_conflicts_b_ingredient_fkey ( slug, name ),
       g:health_goals!protocol_conflicts_b_goal_fkey ( slug, name )`,
    )
    .eq('config_id', configId);

  if (error) {
    logger.error('listConflicts failed', { cause: error.message });
    return [];
  }

  type Raw = {
    id: string;
    kind: string;
    rule: unknown;
    note_i18n: unknown;
    a: { slug: string; name: unknown } | null;
    b: { slug: string; name: unknown } | null;
    g: { slug: string; name: unknown } | null;
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    aName: row.a ? pickLocale(asLocalizedField(row.a.name), 'en') : '—',
    aSlug: row.a?.slug ?? null,
    bName: row.b
      ? pickLocale(asLocalizedField(row.b.name), 'en')
      : row.g
        ? pickLocale(asLocalizedField(row.g.name), 'en')
        : null,
    bIsGoal: row.b === null && row.g !== null,
    kind: row.kind,
    rule: (row.rule ?? {}) as Record<string, unknown>,
    note: pair(row.note_i18n),
  }));
}

// ── Pickers ──────────────────────────────────────────────────────────────────

export interface Option {
  id: string;
  slug: string;
  name: string;
}

export async function listGoalOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('health_goals')
    .select('id, slug, name')
    .eq('is_active', true)
    .order('sort_order');

  return ((data ?? []) as { id: string; slug: string; name: unknown }[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: pickLocale(asLocalizedField(row.name), 'en'),
  }));
}

export async function listIngredientOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('ingredients').select('id, slug, name').order('slug');

  return ((data ?? []) as { id: string; slug: string; name: unknown }[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: pickLocale(asLocalizedField(row.name), 'en'),
  }));
}

// ── Analytics (docs/15 §4) ───────────────────────────────────────────────────

export interface ProtocolAnalytics {
  total: number;
  last7Days: number;
  signedIn: number;
  topCombos: { goals: string; count: number }[];
  byDay: { day: string; count: number }[];
}

/**
 * The analytics card.
 *
 * One read of the recent rows, aggregated in TypeScript. `generated_protocols` is small — one
 * row per generation, not per pageview — and the alternative is three RPCs to answer three
 * questions about the same 500 rows. The cap is explicit rather than implied by Supabase's
 * default 1000: a silent truncation would quietly turn "generations per day" into a lie.
 */
export async function protocolAnalytics(): Promise<ProtocolAnalytics> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('generated_protocols')
    .select('created_at, user_id, inputs')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    logger.error('protocolAnalytics failed', { cause: error.message });
    return { total: 0, last7Days: 0, signedIn: 0, topCombos: [], byDay: [] };
  }

  type Raw = { created_at: string; user_id: string | null; inputs: unknown };
  const rows = (data ?? []) as unknown as Raw[];

  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const combos = new Map<string, number>();
  const days = new Map<string, number>();

  for (const row of rows) {
    const goals = readGoals(row.inputs);
    if (goals.length > 0) {
      const key = [...goals].sort().join(' + ');
      combos.set(key, (combos.get(key) ?? 0) + 1);
    }
    const day = row.created_at.slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }

  return {
    total: rows.length,
    last7Days: rows.filter((row) => new Date(row.created_at).getTime() >= cutoff).length,
    signedIn: rows.filter((row) => row.user_id !== null).length,
    topCombos: [...combos.entries()]
      .map(([goals, count]) => ({ goals, count }))
      .sort((a, b) => b.count - a.count || a.goals.localeCompare(b.goals))
      .slice(0, 6),
    byDay: [...days.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 14),
  };
}

function readGoals(inputs: unknown): string[] {
  if (typeof inputs !== 'object' || inputs === null) return [];
  const goals = (inputs as { goals?: unknown }).goals;
  return Array.isArray(goals) ? goals.filter((g): g is string => typeof g === 'string') : [];
}

/** jsonb `{sq, en}` → a pair, or null when neither side is a string. */
function pair(value: unknown): { sq: string; en: string } | null {
  const field: LocalizedField = asLocalizedField(value);
  if (!field) return null;
  const sq = field.sq ?? '';
  const en = field.en ?? '';
  return sq || en ? { sq, en } : null;
}
