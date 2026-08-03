'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { BANNED_CLAIM_WORDS } from '@/lib/claims';
import {
  ACTIVITY_BANDS,
  AGE_BANDS,
  HEIGHT_BANDS,
  SERVINGS_BY_WEIGHT,
  SEX_BANDS,
  WEIGHT_BANDS,
} from '@/features/biohack/types';
import {
  deleteProfileRule,
  saveProfileRule,
  type BioHackState,
} from '@/features/biohack/admin-actions';
import type { Option, ProfileRuleRow } from '@/features/biohack/admin-queries';

/**
 * docs/15 §9 — the Profile tab.
 *
 * This screen is the reason personalisation is a table. Every "if you are over 50 we weight B12
 * higher" lives here, readable and changeable by the person who understands the nutrition, instead
 * of inside a function only a developer can reach.
 *
 * Two things it deliberately does that a prettier editor would not:
 *
 *   · It shows the **raw stored jsonb** beside the human summary. The engine narrows `when` and
 *     `effect` on the way out and silently drops anything it does not recognise, so a rule can read
 *     as active here and match nobody at runtime. The only way to see that is to see what is
 *     actually stored.
 *   · It warns when a condition is empty. A rule matching everybody is occasionally what you want —
 *     the seeded B12 `require` is exactly that — and far more often a forgotten checkbox.
 */
export function AdminProfileRules({
  configId,
  editable,
  rules,
  ingredients,
  goals,
}: {
  configId: string;
  editable: boolean;
  rules: ProfileRuleRow[];
  ingredients: Option[];
  goals: Option[];
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-sm text-ink-600">
            {rules.length} rule{rules.length === 1 ? '' : 's'}. Each one reads: <em>for this kind of
            person, do this to this ingredient</em>. They are applied in sort order, after the
            medication and caffeine filters and before conflicts and selection.
          </p>
          <p className="mt-1 text-xs text-ink-600">
            A band nobody answered matches nothing — declining to state a sex applies no
            sex-conditioned rule at all. The serving hint multiplies the label serving:{' '}
            {WEIGHT_BANDS.map((band) => `${band}→${SERVINGS_BY_WEIGHT[band]}`).join(', ')}.
          </p>
        </div>

        {editable && (
          <Button size="sm" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            <Plus className="size-4" aria-hidden="true" />
            Add rule
          </Button>
        )}
      </div>

      {editing === 'new' && (
        <RuleForm
          configId={configId}
          ingredients={ingredients}
          goals={goals}
          onDone={() => setEditing(null)}
        />
      )}

      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.id}>
            {editing === rule.id ? (
              <RuleForm
                configId={configId}
                ingredients={ingredients}
                goals={goals}
                rule={rule}
                onDone={() => setEditing(null)}
              />
            ) : (
              <article
                className={cn(
                  'flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3 text-sm',
                  rule.active ? 'border-line bg-surface' : 'border-dashed border-line bg-cream',
                )}
              >
                <span className="font-ui text-xs font-semibold text-ink-600" data-numeric>
                  #{rule.sortOrder}
                </span>
                <span className="font-medium text-ink-900">
                  {rule.ingredientName ?? 'every ingredient'}
                </span>
                <EffectChips effect={rule.effect} />
                {!rule.active && (
                  <span className="rounded-sm bg-ink-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-ink-600">
                    inactive
                  </span>
                )}

                {editable && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(rule.id)}>
                      Edit
                    </Button>
                    <DeleteRule configId={configId} ruleId={rule.id} />
                  </span>
                )}

                <p className="w-full font-mono text-xs text-ink-600">
                  when {JSON.stringify(rule.when)}
                  {Object.keys(rule.when).length === 0 && (
                    <span className="ml-2 rounded-sm bg-warning/20 px-1.5 py-0.5 font-ui font-semibold text-ink-900">
                      matches everybody
                    </span>
                  )}
                </p>
                <p className="w-full text-xs text-ink-600">{rule.reason?.en ?? '(no reason)'}</p>
                {rule.caution && <p className="w-full text-xs text-warning">⚠ {rule.caution.en}</p>}
              </article>
            )}
          </li>
        ))}
      </ul>

      {rules.length === 0 && (
        <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
          No personalisation rules in this version — the five profile questions are collected and
          change nothing.
        </p>
      )}
    </div>
  );
}

/** The stored effect, as chips, so the list scans without reading jsonb. */
function EffectChips({ effect }: { effect: Record<string, unknown> }) {
  const chips: string[] = [];
  if (typeof effect.weight_delta === 'number') {
    chips.push(`${effect.weight_delta > 0 ? '+' : ''}${effect.weight_delta} score`);
  }
  if (effect.exclude === true) chips.push('exclude');
  if (effect.require === true) chips.push('require');
  if (effect.servings_hint === true) chips.push('serving hint');

  if (chips.length === 0) {
    return (
      <span className="rounded-sm bg-error/15 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-900">
        no effect — does nothing
      </span>
    );
  }

  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900"
        >
          {chip}
        </span>
      ))}
    </>
  );
}

function RuleForm({
  configId,
  ingredients,
  goals,
  rule,
  onDone,
}: {
  configId: string;
  ingredients: Option[];
  goals: Option[];
  rule?: ProfileRuleRow;
  onDone: () => void;
}) {
  const [state, action] = useActionState<BioHackState, FormData>(async (previous, formData) => {
    const result = await saveProfileRule(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  /** The stored jsonb uses snake_case lists; the checkboxes need to know what was ticked. */
  const stored = (key: string): string[] => {
    const value = rule?.when[key];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  };

  const num = typeof rule?.effect.weight_delta === 'number' ? rule.effect.weight_delta : 0;

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-md border border-forest-500/40 bg-forest-50/50 p-4"
    >
      <input type="hidden" name="configId" value={configId} />
      {rule && <input type="hidden" name="ruleId" value={rule.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-900">Ingredient</span>
          <select
            name="ingredientId"
            defaultValue=""
            className="h-10 rounded-md border border-line-strong bg-surface px-2.5 text-sm"
          >
            <option value="">Every ingredient</option>
            {ingredients.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <Number name="weightDelta" label="Score change (−100…100)" value={num} />
        <Number name="sortOrder" label="Order" value={rule?.sortOrder ?? 0} />
      </div>

      <fieldset className="flex flex-wrap gap-4">
        <legend className="text-sm font-medium text-ink-900">Effect</legend>
        <Check name="exclude" label="Remove the ingredient" checked={rule?.effect.exclude === true} />
        <Check name="require" label="Guarantee it a place" checked={rule?.effect.require === true} />
        <Check
          name="servingsHint"
          label="Show the body-weight serving note"
          checked={rule?.effect.servings_hint === true}
        />
        <Check name="active" label="Active" checked={rule?.active ?? true} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Bands name="ageBands" label="Age bands" options={AGE_BANDS} checked={stored('age_bands')} />
        <Bands name="sexes" label="Sex" options={SEX_BANDS} checked={stored('sexes')} />
        <Bands
          name="weightBands"
          label="Weight bands"
          options={WEIGHT_BANDS}
          checked={stored('weight_bands')}
        />
        <Bands
          name="heightBands"
          label="Height bands"
          options={HEIGHT_BANDS}
          checked={stored('height_bands')}
        />
        <Bands
          name="activity"
          label="Activity"
          options={ACTIVITY_BANDS}
          checked={stored('activity')}
        />
        <Bands
          name="goals"
          label="Only for these goals"
          options={goals.map((g) => g.slug)}
          checked={stored('goals')}
        />
      </div>

      <p className="text-xs text-ink-600">
        Leave a dimension empty to mean &ldquo;any&rdquo;. Leave <em>every</em> dimension empty and
        the rule fires for everybody.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea name="reasonSq" label="Reason shown to the customer (sq)" value={rule?.reason?.sq ?? ''} />
        <TextArea name="reasonEn" label="Reason shown to the customer (en)" value={rule?.reason?.en ?? ''} />
        <TextArea name="cautionSq" label="Caution (sq, optional)" value={rule?.caution?.sq ?? ''} />
        <TextArea name="cautionEn" label="Caution (en, optional)" value={rule?.caution?.en ?? ''} />
      </div>

      <p className="text-xs text-ink-600">
        The reason is shown on the customer&rsquo;s card, so docs/08 §7 applies. Rejected on save:{' '}
        <span className="font-mono">{BANNED_CLAIM_WORDS.slice(0, 8).join(', ')}…</span>
      </p>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-error">
          {state.error === 'biohack.errors.bannedClaim'
            ? 'The reason makes a medical claim. Describe what a nutrient contributes to.'
            : state.error === 'biohack.errors.notDraft'
              ? 'This version is no longer a draft. Reload the page.'
              : 'Could not save. A rule needs a reason in both locales and at least one effect.'}
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

function DeleteRule({ configId, ruleId }: { configId: string; ruleId: string }) {
  const [, action] = useActionState<BioHackState, FormData>(deleteProfileRule, null);

  return (
    <form action={action}>
      <input type="hidden" name="configId" value={configId} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <SubmitButton variant="ghost" size="sm" aria-label="Delete rule">
        <Trash2 className="size-4" aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

function Bands({
  name,
  label,
  options,
  checked,
}: {
  name: string;
  label: string;
  options: readonly string[];
  checked: string[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-900">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={checked.includes(option)}
              className="size-4 accent-forest-700"
            />
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Check({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean | undefined;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={checked ?? false}
        className="size-4 accent-forest-700"
      />
      {label}
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

function TextArea({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">{label}</span>
      <textarea
        name={name}
        defaultValue={value}
        rows={2}
        className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
      />
    </label>
  );
}
