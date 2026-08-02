'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { TIMING_SLOTS, type EngineSettings } from '@/features/biohack/types';
import {
  approveConfig,
  createDraftConfig,
  deleteConflict,
  rejectConfig,
  saveConflict,
  saveEngineSettings,
  submitConfigForReview,
  type BioHackState,
} from '@/features/biohack/admin-actions';
import type { ConfigSummary, ConflictRow, Option } from '@/features/biohack/admin-queries';

/**
 * docs/15 §4 — the Conflicts, Settings and Versions tabs.
 *
 * Three small screens in one file because they share the same error rendering and the same
 * "disabled unless this is a draft" rule, and splitting them would mean three copies of both.
 */

function errorText(state: BioHackState): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case 'biohack.errors.bannedClaim':
      return 'That copy makes a medical claim. Rewrite it as a contribution, not a cure.';
    case 'biohack.errors.notDraft':
      return 'Only a draft can be edited. Reload the page.';
    case 'biohack.errors.draftExists':
      return 'A draft already exists. Finish or reject it before starting another.';
    case 'biohack.errors.noApproved':
      return 'There is no approved version to copy from.';
    case 'biohack.errors.emptyConfig':
      return 'A version with no blocks cannot be submitted — the generator would return nothing.';
    case 'admin.errors.forbidden':
      return 'Your role cannot do that.';
    default:
      return 'Something went wrong. Try again.';
  }
}

// ── Conflicts ────────────────────────────────────────────────────────────────

export function AdminConflicts({
  configId,
  editable,
  conflicts,
  ingredients,
  goals,
}: {
  configId: string;
  editable: boolean;
  conflicts: ConflictRow[];
  ingredients: Option[];
  goals: Option[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          {conflicts.length} rule{conflicts.length === 1 ? '' : 's'}. Applied in order: exclude,
          then timing, then caution (docs/15 §3.5).
        </p>
        {editable && (
          <Button size="sm" onClick={() => setAdding(!adding)}>
            <Plus className="size-4" aria-hidden="true" />
            Add rule
          </Button>
        )}
      </div>

      {adding && (
        <ConflictForm
          configId={configId}
          ingredients={ingredients}
          goals={goals}
          onDone={() => setAdding(false)}
        />
      )}

      <ul className="flex flex-col gap-2">
        {conflicts.map((conflict) => (
          <li
            key={conflict.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-surface p-3 text-sm"
          >
            <span className="rounded-sm bg-ink-600/10 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-600">
              {conflict.kind}
            </span>
            <span className="font-medium text-ink-900">{conflict.aName}</span>
            <span className="text-ink-600">×</span>
            <span className="font-medium text-ink-900">
              {conflict.bName ?? '—'}
              {conflict.bIsGoal && <span className="ml-1 text-xs text-ink-600">(goal)</span>}
            </span>
            <span className="font-mono text-xs text-ink-600">{JSON.stringify(conflict.rule)}</span>

            {editable && (
              <span className="ml-auto">
                <DeleteConflict configId={configId} conflictId={conflict.id} />
              </span>
            )}

            {conflict.note && (
              <p className="w-full text-xs text-ink-600">{conflict.note.en || conflict.note.sq}</p>
            )}
          </li>
        ))}
      </ul>

      {conflicts.length === 0 && (
        <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
          No conflict rules in this version.
        </p>
      )}
    </div>
  );
}

function ConflictForm({
  configId,
  ingredients,
  goals,
  onDone,
}: {
  configId: string;
  ingredients: Option[];
  goals: Option[];
  onDone: () => void;
}) {
  const [state, action] = useActionState<BioHackState, FormData>(async (previous, formData) => {
    const result = await saveConflict(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  const [kind, setKind] = useState<'exclude' | 'caution' | 'timing_rule'>('timing_rule');

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-md border border-forest-500/40 bg-forest-50/50 p-4"
    >
      <input type="hidden" name="configId" value={configId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Select name="aIngredientId" label="Ingredient A" options={ingredients} />
        <Select name="bIngredientId" label="Ingredient B (optional)" options={ingredients} optional />
        <Select name="bGoalId" label="…or goal B (optional)" options={goals} optional />
      </div>

      <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
        <span className="font-medium text-ink-900">Kind</span>
        <select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}
          className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
        >
          <option value="timing_rule">timing_rule — restrict to slots</option>
          <option value="exclude">exclude — drop the lower-scored side</option>
          <option value="caution">caution — attach a note</option>
        </select>
      </label>

      {kind === 'timing_rule' && (
        <fieldset>
          <legend className="text-sm font-medium text-ink-900">Allowed slots</legend>
          <div className="mt-1.5 flex flex-wrap gap-3">
            {TIMING_SLOTS.map((slot) => (
              <label key={slot} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="allowedSlots"
                  value={slot}
                  className="size-4 accent-forest-700"
                />
                {slot}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {kind === 'caution' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="separateSlots" value="true" className="size-4 accent-forest-700" />
          Take at separate times
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Note (sq)</span>
          <textarea name="noteSq" rows={2} className="rounded-md border border-line-strong bg-surface p-2.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Note (en)</span>
          <textarea name="noteEn" rows={2} className="rounded-md border border-line-strong bg-surface p-2.5 text-sm" />
        </label>
      </div>

      {errorText(state) && (
        <p role="alert" className="text-sm text-error">
          {errorText(state)}
        </p>
      )}

      <div className="flex gap-2">
        <SubmitButton size="sm">Save rule</SubmitButton>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteConflict({ configId, conflictId }: { configId: string; conflictId: string }) {
  const [, action] = useActionState<BioHackState, FormData>(deleteConflict, null);

  return (
    <form action={action}>
      <input type="hidden" name="configId" value={configId} />
      <input type="hidden" name="conflictId" value={conflictId} />
      <SubmitButton variant="ghost" size="sm" aria-label="Delete rule">
        <Trash2 className="size-4" aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function AdminEngineSettings({ settings }: { settings: EngineSettings }) {
  const [state, action] = useActionState<BioHackState, FormData>(saveEngineSettings, null);

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm text-ink-600">
        `settings.biohack_engine`. These are operational dials, not the ruleset — they apply
        immediately and are not part of the approval cycle.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Number name="maxItems" label="Max items" value={settings.maxItems} />
        <Number name="minItems" label="Min items" value={settings.minItems} />
        <Number name="maxGoals" label="Max goals" value={settings.maxGoals} />
        <Number name="durationDays" label="Duration (days)" value={settings.durationDays} />
        <Number
          name="budgetLow"
          label="Budget tier 1 (cents)"
          value={settings.budgetTiers[0] ?? 2000}
        />
        <Number
          name="budgetMid"
          label="Budget tier 2 (cents)"
          value={settings.budgetTiers[1] ?? 4000}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="perGoalCoreGuarantee"
          value="true"
          defaultChecked={settings.perGoalCoreGuarantee}
          className="size-4 accent-forest-700"
        />
        Guarantee one core block per selected goal
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="subscriptionConvert"
          value="true"
          defaultChecked={settings.subscriptionConvert}
          className="size-4 accent-forest-700"
        />
        Offer &ldquo;turn into a subscription&rdquo;
      </label>

      {state?.ok && <p className="text-sm text-forest-800">Saved.</p>}
      {errorText(state) && (
        <p role="alert" className="text-sm text-error">
          {errorText(state)}
        </p>
      )}

      <div>
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </form>
  );
}

// ── Versions and approval ────────────────────────────────────────────────────

export function AdminVersions({
  configs,
  canEdit,
  canApprove,
}: {
  configs: ConfigSummary[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  /*
   * Typed on `FormData` even though the action takes no input. `useActionState<_, void>` produces
   * a `(payload: void) => void`, which a `<form action={…}>` will not accept — the form always
   * hands its action a `FormData`. Ignoring it is fine; mistyping it is a build error.
   */
  const [draftState, draftAction, draftPending] = useActionState<BioHackState, FormData>(
    async () => createDraftConfig(),
    null,
  );

  const hasEditable = configs.some((c) => c.status === 'draft' || c.status === 'pending_review');

  return (
    <div className="flex flex-col gap-5">
      {canEdit && !hasEditable && (
        <form action={draftAction}>
          <SubmitButton disabled={draftPending}>Start a new draft from the approved version</SubmitButton>
        </form>
      )}

      {errorText(draftState) && (
        <p role="alert" className="text-sm text-error">
          {errorText(draftState)}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {configs.map((config) => (
          <li
            key={config.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-surface p-4 text-sm"
          >
            <span className="font-ui text-base font-semibold text-forest-900" data-numeric>
              v{config.version}
            </span>
            <StatusChip status={config.status} />
            <span className="text-ink-600" data-numeric>
              {config.blockCount} blocks · {config.conflictCount} rules
            </span>
            {config.approvedByName && (
              <span className="text-xs text-ink-600">approved by {config.approvedByName}</span>
            )}

            <span className="ml-auto flex flex-wrap gap-2">
              {canEdit && config.status === 'draft' && (
                <ReviewForm configId={config.id} action="submit" />
              )}
              {canApprove && config.status === 'pending_review' && (
                <>
                  <ReviewForm configId={config.id} action="approve" />
                  <ReviewForm configId={config.id} action="reject" />
                </>
              )}
            </span>

            {config.notes && <p className="w-full text-xs text-ink-600">{config.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewForm({
  configId,
  action,
}: {
  configId: string;
  action: 'submit' | 'approve' | 'reject';
}) {
  const handler =
    action === 'submit' ? submitConfigForReview : action === 'approve' ? approveConfig : rejectConfig;

  const [state, formAction] = useActionState<BioHackState, FormData>(handler, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="configId" value={configId} />
      {action !== 'submit' && (
        <input
          type="text"
          name="notes"
          placeholder="Note (optional)"
          className="h-9 w-40 rounded-md border border-line-strong bg-surface px-2 text-xs"
        />
      )}
      <SubmitButton
        size="sm"
        variant={action === 'approve' ? 'primary' : action === 'reject' ? 'destructive' : 'secondary'}
      >
        {action === 'submit' ? 'Send for approval' : action === 'approve' ? 'Approve' : 'Send back'}
      </SubmitButton>
      {errorText(state) && (
        <span role="alert" className="text-xs text-error">
          {errorText(state)}
        </span>
      )}
    </form>
  );
}

function StatusChip({ status }: { status: ConfigSummary['status'] }) {
  const tone =
    status === 'approved'
      ? 'bg-success text-white'
      : status === 'pending_review'
        ? 'bg-warning text-white'
        : status === 'draft'
          ? 'bg-forest-800 text-white'
          : 'bg-ink-600 text-white';

  return (
    <span className={cn('rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold', tone)}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Select({
  name,
  label,
  options,
  optional = false,
}: {
  name: string;
  label: string;
  options: Option[];
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">{label}</span>
      <select
        name={name}
        defaultValue=""
        className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
      >
        <option value="">{optional ? 'None' : 'Select…'}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Number({ name, label, value }: { name: string; label: string; value: number }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={value}
        className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
      />
    </label>
  );
}
