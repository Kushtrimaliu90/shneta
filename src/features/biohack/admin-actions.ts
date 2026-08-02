'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { findBannedClaims } from '@/lib/claims';
import { audit, requireCapability } from '@/features/admin/audit';
import { BIOHACK_TAGS } from '@/features/biohack/config-loader';
import { TIMING_SLOTS } from '@/features/biohack/types';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/15 §4 — the ruleset editor's mutations.
 *
 * Every one of them: capability re-check, Zod, SSR client so RLS applies, `audit_logs`, and a
 * `revalidatePath` back to the tab that called it. The one that is different is `approveConfig`,
 * which also purges the storefront's config cache — approving a version that nobody sees until
 * a cache expires is the same as not approving it.
 *
 * **Only draft versions are editable, and that is enforced per statement rather than per screen.**
 * Each write joins through `config_id` to a config whose status is `draft`; a stale tab pointing
 * at a version that has since been submitted or approved writes nothing. An approved config is
 * the record of what compliance signed, and it has to be immutable for that signature to mean
 * anything.
 */

export type BioHackErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'biohack.errors.notDraft'
  | 'biohack.errors.bannedClaim'
  | 'biohack.errors.noApproved'
  | 'biohack.errors.draftExists'
  | 'biohack.errors.emptyConfig';

export type BioHackState = ActionResult<{ id?: string; version?: number }, BioHackErrorKey> | null;

function no(error: BioHackErrorKey): BioHackState {
  return fail<BioHackErrorKey, { id?: string; version?: number }>(error);
}

/** Proves the config is a draft before anything writes to it. */
async function assertDraft(configId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('protocol_configs')
    .select('status')
    .eq('id', configId)
    .maybeSingle();

  return (data as { status: string } | null)?.status === 'draft';
}

function refresh(): void {
  revalidatePath('/admin/biohack');
}

// ── Versioning (docs/15 §4) ──────────────────────────────────────────────────

/**
 * Copies the approved version into a new draft.
 *
 * A **copy**, not a fresh empty version, and not an edit of the live one. Editing live is out
 * for the reason above; starting empty would mean rebuilding fifty-one blocks to change one
 * weight. So the draft begins as an exact duplicate and the diff a compliance manager reviews is
 * genuinely the change, not the whole ruleset.
 *
 * One draft at a time. Two people editing two drafts and approving them in the other order would
 * silently discard whichever landed first, and there is no merge to reach for.
 */
export async function createDraftConfig(): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('protocol_configs')
      .select('id')
      .in('status', ['draft', 'pending_review'])
      .limit(1)
      .maybeSingle();

    if (existing) return no('biohack.errors.draftExists');

    const { data: approved } = await supabase
      .from('protocol_configs')
      .select('id')
      .eq('status', 'approved')
      .maybeSingle();

    if (!approved) return no('biohack.errors.noApproved');
    const sourceId = (approved as { id: string }).id;

    const { data: created, error } = await supabase
      .from('protocol_configs')
      .insert({ status: 'draft', created_by: gate.actor.id })
      .select('id, version')
      .single();

    if (error || !created) {
      logger.error('createDraftConfig failed', { cause: error?.message });
      return no('admin.errors.generic');
    }

    const draft = created as { id: string; version: number };

    /*
     * Copied row by row through the client rather than by an `insert … select` in SQL.
     *
     * A server-side copy would be one statement and would need a security-definer function to
     * run it, which means a function that can write blocks into any config. Fifty-one rows read
     * and written once, when someone starts a draft, is not worth that.
     */
    const { data: blocks } = await supabase
      .from('protocol_blocks')
      .select(
        'goal_id, ingredient_id, habit_i18n, weight, is_core, timing, phase, why_i18n, evidence, caution_i18n, active',
      )
      .eq('config_id', sourceId);

    if (blocks && blocks.length > 0) {
      const { error: blockError } = await supabase
        .from('protocol_blocks')
        .insert(blocks.map((row) => ({ ...row, config_id: draft.id })));
      if (blockError) logger.error('draft block copy failed', { cause: blockError.message });
    }

    const { data: conflicts } = await supabase
      .from('protocol_conflicts')
      .select('a_ingredient, b_ingredient, b_goal, kind, rule, note_i18n')
      .eq('config_id', sourceId);

    if (conflicts && conflicts.length > 0) {
      const { error: conflictError } = await supabase
        .from('protocol_conflicts')
        .insert(conflicts.map((row) => ({ ...row, config_id: draft.id })));
      if (conflictError)
        logger.error('draft conflict copy failed', { cause: conflictError.message });
    }

    await audit('biohack_config.draft_created', 'protocol_config', draft.id, null, {
      copied_from: sourceId,
      blocks: blocks?.length ?? 0,
    });

    refresh();
    return ok({ id: draft.id, version: draft.version });
  } catch (error) {
    logger.error('createDraftConfig threw', describeError(error));
    return no('admin.errors.generic');
  }
}

const configIdSchema = z.object({ configId: z.string().uuid(), notes: z.string().max(2000).optional() });

/** draft → pending_review. The point at which the product manager stops and compliance starts. */
export async function submitConfigForReview(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = configIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  try {
    const supabase = await createClient();

    /*
     * An empty draft cannot be submitted. The generator returns nothing at all without blocks,
     * so approving one would take the feature down — and it would look like a cache problem
     * rather than an approval, which is the worst kind of outage to diagnose.
     */
    const { count } = await supabase
      .from('protocol_blocks')
      .select('id', { count: 'exact', head: true })
      .eq('config_id', parsed.data.configId);

    if ((count ?? 0) === 0) return no('biohack.errors.emptyConfig');

    const { error } = await supabase
      .from('protocol_configs')
      .update({ status: 'pending_review', notes: parsed.data.notes ?? null })
      .eq('id', parsed.data.configId)
      .eq('status', 'draft');

    if (error) {
      logger.error('submitConfigForReview failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_config.submitted', 'protocol_config', parsed.data.configId, null, {
      blocks: count ?? 0,
    });

    refresh();
    return ok({ id: parsed.data.configId });
  } catch (error) {
    logger.error('submitConfigForReview threw', describeError(error));
    return no('admin.errors.generic');
  }
}

/**
 * pending_review → approved, and the storefront switches.
 *
 * Three things in one action, in this order: archive the current approved version, approve this
 * one, purge the cache. The order matters — `one_approved_protocol_config` is a partial unique
 * index, so approving before archiving raises a constraint violation rather than silently
 * producing two live versions. The index is doing the work; this just cooperates with it.
 *
 * `revalidateTag` is the third step and not an afterthought. `getApprovedConfig` is an
 * `unstable_cache` entry with no TTL, so without this the storefront would keep serving the old
 * ruleset until the next deploy (docs/13 §K1).
 */
export async function approveConfig(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return no(gate.error);

  const parsed = configIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  try {
    const supabase = await createClient();

    const { data: target } = await supabase
      .from('protocol_configs')
      .select('id, version, status')
      .eq('id', parsed.data.configId)
      .maybeSingle();

    const row = target as { id: string; version: number; status: string } | null;
    if (!row || row.status !== 'pending_review') return no('biohack.errors.notDraft');

    const { error: archiveError } = await supabase
      .from('protocol_configs')
      .update({ status: 'archived' })
      .eq('status', 'approved');

    if (archiveError) {
      logger.error('approveConfig archive failed', { cause: archiveError.message });
      return no('admin.errors.generic');
    }

    /*
     * `notes` is only written when the approver typed one. Defaulting it would overwrite the
     * note the product manager left when they submitted — the one explaining what changed, which
     * is the most useful line on the Versions tab.
     */
    const { error } = await supabase
      .from('protocol_configs')
      .update({
        status: 'approved',
        approved_by: gate.actor.id,
        approved_at: new Date().toISOString(),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      })
      .eq('id', row.id)
      .eq('status', 'pending_review');

    if (error) {
      logger.error('approveConfig failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_config.approved', 'protocol_config', row.id, null, {
      version: row.version,
    });

    revalidateTag(BIOHACK_TAGS.config);
    refresh();
    return ok({ id: row.id, version: row.version });
  } catch (error) {
    logger.error('approveConfig threw', describeError(error));
    return no('admin.errors.generic');
  }
}

/** pending_review → draft. Compliance handing it back, with the reason in `notes`. */
export async function rejectConfig(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return no(gate.error);

  const parsed = configIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('protocol_configs')
      .update({ status: 'draft', notes: parsed.data.notes ?? null })
      .eq('id', parsed.data.configId)
      .eq('status', 'pending_review');

    if (error) {
      logger.error('rejectConfig failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_config.rejected', 'protocol_config', parsed.data.configId, null, {
      notes: parsed.data.notes ?? null,
    });

    refresh();
    return ok({ id: parsed.data.configId });
  } catch (error) {
    logger.error('rejectConfig threw', describeError(error));
    return no('admin.errors.generic');
  }
}

// ── Blocks (the Matrix tab) ──────────────────────────────────────────────────

const timingSlot = z.enum(TIMING_SLOTS);

const blockSchema = z.object({
  configId: z.string().uuid(),
  blockId: z.string().uuid().optional(),
  goalId: z.string().uuid(),
  ingredientId: z.string().uuid().optional().or(z.literal('')),
  habitSq: z.string().trim().max(200).optional(),
  habitEn: z.string().trim().max(200).optional(),
  weight: z.coerce.number().int().min(1).max(100),
  isCore: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
  phase: z.coerce.number().int().min(1).max(2),
  whySq: z.string().trim().min(10).max(400),
  whyEn: z.string().trim().min(10).max(400),
  cautionSq: z.string().trim().max(400).optional(),
  cautionEn: z.string().trim().max(400).optional(),
});

/**
 * Create or update one block.
 *
 * `timing` arrives as repeated checkboxes and is read with `getAll`. `Object.fromEntries` keeps
 * only the last value of a repeated key — the bug that silently reduced five related products to
 * one in the product editor (docs/13 §Q3) — and here it would quietly drop every slot but one.
 */
export async function saveBlock(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = blockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  const timing = formData
    .getAll('timing')
    .map(String)
    .filter((slot): slot is (typeof TIMING_SLOTS)[number] => timingSlot.safeParse(slot).success);

  const input = parsed.data;

  /*
   * docs/15 §4 — hard block, not a warning.
   *
   * Both locales and the caution text together: a claim is a claim in whichever language a
   * customer reads it, and the caution field reaches the same page as the PSE line.
   */
  const banned = findBannedClaims(
    [input.whySq, input.whyEn, input.cautionSq ?? '', input.cautionEn ?? ''].join(' '),
  );
  if (banned.length > 0) return no('biohack.errors.bannedClaim');

  if (!(await assertDraft(input.configId))) return no('biohack.errors.notDraft');

  const habit =
    input.habitSq || input.habitEn
      ? { sq: input.habitSq ?? '', en: input.habitEn ?? '' }
      : null;

  // The table's CHECK requires one or the other; catching it here gives a usable message.
  if (!input.ingredientId && !habit) return no('admin.errors.generic');

  const row = {
    config_id: input.configId,
    goal_id: input.goalId,
    ingredient_id: input.ingredientId || null,
    habit_i18n: (habit as unknown as Json) ?? null,
    weight: input.weight,
    is_core: Boolean(input.isCore),
    active: Boolean(input.active),
    // Never empty: the column defaults to `{mengjes}` and a block with no time is unrenderable.
    timing: timing.length > 0 ? timing : ['mengjes' as const],
    phase: input.phase,
    why_i18n: { sq: input.whySq, en: input.whyEn } as unknown as Json,
    caution_i18n:
      input.cautionSq || input.cautionEn
        ? ({ sq: input.cautionSq ?? '', en: input.cautionEn ?? '' } as unknown as Json)
        : null,
  };

  try {
    const supabase = await createClient();

    const { data, error } = input.blockId
      ? await supabase
          .from('protocol_blocks')
          .update(row)
          .eq('id', input.blockId)
          .eq('config_id', input.configId)
          .select('id')
          .maybeSingle()
      : await supabase.from('protocol_blocks').insert(row).select('id').maybeSingle();

    if (error || !data) {
      logger.error('saveBlock failed', { cause: error?.message });
      return no('admin.errors.generic');
    }

    await audit(
      input.blockId ? 'biohack_block.updated' : 'biohack_block.created',
      'protocol_block',
      (data as { id: string }).id,
      null,
      { goal_id: input.goalId, weight: input.weight },
    );

    refresh();
    return ok({ id: (data as { id: string }).id });
  } catch (error) {
    logger.error('saveBlock threw', describeError(error));
    return no('admin.errors.generic');
  }
}

const deleteBlockSchema = z.object({ configId: z.string().uuid(), blockId: z.string().uuid() });

export async function deleteBlock(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = deleteBlockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');
  if (!(await assertDraft(parsed.data.configId))) return no('biohack.errors.notDraft');

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('protocol_blocks')
      .delete()
      .eq('id', parsed.data.blockId)
      .eq('config_id', parsed.data.configId);

    if (error) {
      logger.error('deleteBlock failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_block.deleted', 'protocol_block', parsed.data.blockId, null, null);
    refresh();
    return ok({ id: parsed.data.blockId });
  } catch (error) {
    logger.error('deleteBlock threw', describeError(error));
    return no('admin.errors.generic');
  }
}

// ── Conflicts ────────────────────────────────────────────────────────────────

const conflictSchema = z.object({
  configId: z.string().uuid(),
  conflictId: z.string().uuid().optional(),
  aIngredientId: z.string().uuid(),
  bIngredientId: z.string().uuid().optional().or(z.literal('')),
  bGoalId: z.string().uuid().optional().or(z.literal('')),
  kind: z.enum(['exclude', 'caution', 'timing_rule']),
  separateSlots: z.coerce.boolean().optional(),
  noteSq: z.string().trim().max(400).optional(),
  noteEn: z.string().trim().max(400).optional(),
});

export async function saveConflict(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = conflictSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  const input = parsed.data;
  const banned = findBannedClaims(`${input.noteSq ?? ''} ${input.noteEn ?? ''}`);
  if (banned.length > 0) return no('biohack.errors.bannedClaim');
  if (!(await assertDraft(input.configId))) return no('biohack.errors.notDraft');

  const allowedSlots = formData
    .getAll('allowedSlots')
    .map(String)
    .filter((slot) => timingSlot.safeParse(slot).success);

  /*
   * The rule is stored as jsonb and read back by the engine's two named fields. Writing only
   * the field this kind uses keeps a stale `allowed_slots` from surviving a change to `caution`
   * and quietly constraining timing for a rule that no longer says anything about timing.
   */
  const rule =
    input.kind === 'timing_rule'
      ? { allowed_slots: allowedSlots }
      : input.separateSlots
        ? { separate_slots: true }
        : {};

  const row = {
    config_id: input.configId,
    a_ingredient: input.aIngredientId,
    b_ingredient: input.bIngredientId || null,
    b_goal: input.bGoalId || null,
    kind: input.kind,
    rule: rule as unknown as Json,
    note_i18n:
      input.noteSq || input.noteEn
        ? ({ sq: input.noteSq ?? '', en: input.noteEn ?? '' } as unknown as Json)
        : null,
  };

  try {
    const supabase = await createClient();

    const { data, error } = input.conflictId
      ? await supabase
          .from('protocol_conflicts')
          .update(row)
          .eq('id', input.conflictId)
          .eq('config_id', input.configId)
          .select('id')
          .maybeSingle()
      : await supabase.from('protocol_conflicts').insert(row).select('id').maybeSingle();

    if (error || !data) {
      logger.error('saveConflict failed', { cause: error?.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_conflict.saved', 'protocol_conflict', (data as { id: string }).id, null, {
      kind: input.kind,
    });

    refresh();
    return ok({ id: (data as { id: string }).id });
  } catch (error) {
    logger.error('saveConflict threw', describeError(error));
    return no('admin.errors.generic');
  }
}

const deleteConflictSchema = z.object({
  configId: z.string().uuid(),
  conflictId: z.string().uuid(),
});

export async function deleteConflict(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = deleteConflictSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');
  if (!(await assertDraft(parsed.data.configId))) return no('biohack.errors.notDraft');

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('protocol_conflicts')
      .delete()
      .eq('id', parsed.data.conflictId)
      .eq('config_id', parsed.data.configId);

    if (error) {
      logger.error('deleteConflict failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_conflict.deleted', 'protocol_conflict', parsed.data.conflictId, null, null);
    refresh();
    return ok({ id: parsed.data.conflictId });
  } catch (error) {
    logger.error('deleteConflict threw', describeError(error));
    return no('admin.errors.generic');
  }
}

// ── Engine settings ──────────────────────────────────────────────────────────

const settingsSchema = z.object({
  maxItems: z.coerce.number().int().min(1).max(12),
  minItems: z.coerce.number().int().min(1).max(12),
  maxGoals: z.coerce.number().int().min(1).max(5),
  durationDays: z.coerce.number().int().min(7).max(120),
  budgetLow: z.coerce.number().int().min(100).max(100_000),
  budgetMid: z.coerce.number().int().min(100).max(100_000),
  perGoalCoreGuarantee: z.coerce.boolean().optional(),
  subscriptionConvert: z.coerce.boolean().optional(),
});

/**
 * `settings.biohack_engine`.
 *
 * Not versioned with the config, deliberately. These are operational dials — how many items, how
 * long a protocol runs — not the copy and rules compliance signs off, and putting them behind an
 * approval cycle would mean a two-step review to change a duration.
 *
 * Purges the config cache anyway, because `getApprovedConfig` carries them into `ProtocolConfig`.
 */
export async function saveEngineSettings(
  _previous: BioHackState,
  formData: FormData,
): Promise<BioHackState> {
  const gate = await requireCapability('biohack.manage');
  if (!gate.ok) return no(gate.error);

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('admin.errors.generic');

  const input = parsed.data;
  // A minimum above the maximum is a config that can never be satisfied.
  const minItems = Math.min(input.minItems, input.maxItems);
  const [low, high] = [input.budgetLow, input.budgetMid].sort((a, b) => a - b);

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('settings')
      .update({
        value: {
          max_items: input.maxItems,
          min_items: minItems,
          max_goals: input.maxGoals,
          per_goal_core_guarantee: Boolean(input.perGoalCoreGuarantee),
          duration_days: input.durationDays,
          budget_tiers: [low, high],
          subscription_convert: Boolean(input.subscriptionConvert),
        } as unknown as Json,
      })
      .eq('key', 'biohack_engine');

    if (error) {
      logger.error('saveEngineSettings failed', { cause: error.message });
      return no('admin.errors.generic');
    }

    await audit('biohack_settings.updated', 'setting', 'biohack_engine', null, {
      max_items: input.maxItems,
      duration_days: input.durationDays,
    });

    revalidateTag(BIOHACK_TAGS.config);
    refresh();
    return ok({});
  } catch (error) {
    logger.error('saveEngineSettings threw', describeError(error));
    return no('admin.errors.generic');
  }
}
