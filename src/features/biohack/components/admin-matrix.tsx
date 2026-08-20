'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { deleteBlock, saveBlock, type BioHackState } from '@/features/biohack/admin-actions';
import { BANNED_CLAIM_WORDS } from '@/lib/claims';
import { TIMING_SLOTS } from '@/features/biohack/types';
import type { BlockRow, Option } from '@/features/biohack/admin-queries';

/**
 * docs/15 §4 — the Matrix tab: a goal's ranked blocks, editable.
 *
 * **A weight field, not drag-to-reorder.** The spec asks for dragging; a number is better here
 * and it is not a shortcut. Weight is not a rank — it is a score that *sums across goals*, which
 * is the whole synergy mechanism (§3.3). Two goals weighting magnesium 90 and 75 produce 165, and
 * a drag handle can express the order of one list while saying nothing about the number that
 * produces it. Editing the number edits the thing the engine actually reads.
 *
 * The list is read-only until a draft exists. Approved versions are immutable — that is what
 * makes an approval mean something — so the editor renders disabled rather than absent, and the
 * Versions tab is where a draft gets started.
 */
export function AdminMatrix({
  configId,
  editable,
  goals,
  ingredients,
  goalSlug,
  blocks,
}: {
  configId: string;
  editable: boolean;
  goals: Option[];
  ingredients: Option[];
  goalSlug: string;
  blocks: BlockRow[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const goal = goals.find((g) => g.slug === goalSlug);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          {blocks.length} block{blocks.length === 1 ? '' : 's'} for{' '}
          <strong className="font-medium text-ink-900">{goal?.name ?? goalSlug}</strong>
          {blocks.filter((b) => b.isCore).length === 0 && (
            <span className="ml-2 rounded-sm bg-warning/20 px-1.5 py-0.5 text-xs font-semibold text-ink-900">
              no core block
            </span>
          )}
        </p>

        {editable && (
          <Button size="sm" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            <Plus className="size-4" aria-hidden="true" />
            Add block
          </Button>
        )}
      </div>

      {editing === 'new' && goal && (
        <BlockForm
          configId={configId}
          goalId={goal.id}
          ingredients={ingredients}
          onDone={() => setEditing(null)}
        />
      )}

      <ul className="flex flex-col gap-2">
        {blocks.map((block) => (
          <li key={block.id}>
            {editing === block.id ? (
              <BlockForm
                configId={configId}
                goalId={block.goalId}
                ingredients={ingredients}
                block={block}
                onDone={() => setEditing(null)}
              />
            ) : (
              <article
                className={cn(
                  'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3 text-sm',
                  block.active ? 'border-line bg-surface' : 'border-dashed border-line bg-cream',
                )}
              >
                <span className="font-ui text-base font-semibold text-forest-900" data-numeric>
                  {block.weight}
                </span>
                <span className="font-medium text-ink-900">
                  {block.ingredientName ?? block.habit?.en ?? block.habit?.sq ?? '—'}
                </span>
                {block.ingredientName === null && <Tag tone="lime">habit</Tag>}
                {block.isCore && <Tag tone="forest">core</Tag>}
                {block.phase === 2 && <Tag>phase 2</Tag>}
                {!block.active && <Tag>inactive</Tag>}
                <span className="text-xs text-ink-600">{block.timing.join(', ')}</span>

                {editable && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(block.id)}>
                      Edit
                    </Button>
                    <DeleteBlock configId={configId} blockId={block.id} />
                  </span>
                )}

                <p className="w-full text-xs text-ink-600">{block.why.en || block.why.sq}</p>
                {block.caution && (
                  <p className="w-full text-xs text-warning">
                    ⚠ {block.caution.en || block.caution.sq}
                  </p>
                )}
              </article>
            )}
          </li>
        ))}
      </ul>

      {blocks.length === 0 && (
        <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
          No blocks for this goal yet. docs/15 §5 asks for at least three, one of them core.
        </p>
      )}
    </div>
  );
}

function BlockForm({
  configId,
  goalId,
  ingredients,
  block,
  onDone,
}: {
  configId: string;
  goalId: string;
  ingredients: Option[];
  block?: BlockRow;
  onDone: () => void;
}) {
  const [state, action] = useActionState<BioHackState, FormData>(async (previous, formData) => {
    const result = await saveBlock(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  const [isHabit, setIsHabit] = useState(block ? block.ingredientId === null : false);

  return (
    <ActionForm
      action={action}
      state={state}
      className="flex flex-col gap-4 rounded-md border border-forest-500/40 bg-forest-50/50 p-4"
    >
      <input type="hidden" name="configId" value={configId} />
      <input type="hidden" name="goalId" value={goalId} />
      {block && <input type="hidden" name="blockId" value={block.id} />}

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isHabit}
            onChange={(event) => setIsHabit(event.target.checked)}
            className="size-4 accent-forest-700"
          />
          This is a habit, not a supplement
        </label>
      </div>

      {isHabit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="habitSq" label="Habit (sq)" defaultValue={block?.habit?.sq ?? ''} />
          <TextField name="habitEn" label="Habit (en)" defaultValue={block?.habit?.en ?? ''} />
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Ingredient</span>
          <select
            name="ingredientId"
            defaultValue={block?.ingredientId ?? ''}
            className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
          >
            <option value="">Select…</option>
            {ingredients.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.slug})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <TextField
          name="weight"
          label="Weight (1–100)"
          type="number"
          defaultValue={String(block?.weight ?? 50)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Phase</span>
          <select
            name="phase"
            defaultValue={String(block?.phase ?? 1)}
            className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
          >
            <option value="1">1 — from day one</option>
            <option value="2">2 — from week two</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            name="isCore"
            value="true"
            defaultChecked={block?.isCore ?? false}
            className="size-4 accent-forest-700"
          />
          Core for this goal
        </label>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            name="active"
            value="true"
            defaultChecked={block?.active ?? true}
            className="size-4 accent-forest-700"
          />
          Active
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink-900">Timing</legend>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {TIMING_SLOTS.map((slot) => (
            <label key={slot} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="timing"
                value={slot}
                defaultChecked={(block?.timing ?? ['mengjes']).includes(slot)}
                className="size-4 accent-forest-700"
              />
              {slot}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea name="whySq" label='"PSE" copy (sq)' defaultValue={block?.why.sq ?? ''} />
        <TextArea name="whyEn" label='"WHY" copy (en)' defaultValue={block?.why.en ?? ''} />
        <TextArea
          name="cautionSq"
          label="Caution (sq, optional)"
          defaultValue={block?.caution?.sq ?? ''}
        />
        <TextArea
          name="cautionEn"
          label="Caution (en, optional)"
          defaultValue={block?.caution?.en ?? ''}
        />
      </div>

      <p className="text-xs text-ink-600">
        docs/08 §7 — this copy is a health claim. These words are rejected on save:{' '}
        <span className="font-mono">{BANNED_CLAIM_WORDS.slice(0, 8).join(', ')}…</span>
      </p>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'biohack.errors.bannedClaim'
            ? 'The copy makes a medical claim. Describe what a nutrient contributes to, never what it fixes.'
            : state.error === 'biohack.errors.notDraft'
              ? 'This version is no longer a draft. Reload the page.'
              : 'Could not save. Check the required fields.'}
        </p>
      )}

      <div className="flex gap-2">
        <SubmitButton size="sm">Save block</SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

function DeleteBlock({ configId, blockId }: { configId: string; blockId: string }) {
  const [, action] = useActionState<BioHackState, FormData>(deleteBlock, null);

  return (
    <form action={action}>
      <input type="hidden" name="configId" value={configId} />
      <input type="hidden" name="blockId" value={blockId} />
      <SubmitButton variant="ghost" size="sm" aria-label="Delete block">
        <Trash2 className="size-4" aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={2}
        className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
      />
    </label>
  );
}

function Tag({
  children,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  tone?: 'quiet' | 'forest' | 'lime';
}) {
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold',
        tone === 'forest' && 'bg-forest-800 text-white',
        tone === 'lime' && 'bg-lime-500/20 text-forest-900',
        tone === 'quiet' && 'bg-ink-600/10 text-ink-600',
      )}
    >
      {children}
    </span>
  );
}
