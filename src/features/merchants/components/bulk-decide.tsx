'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { useFormDraft } from '@/components/ui/use-form-draft';
import { cn } from '@/lib/utils';
import {
  SKIP_REASONS,
  bulkHeadline,
  proposalFollowUp,
  type BulkDecision,
  type BulkProposalDecision,
} from '@/features/merchants/decisions';

/**
 * The multi-select bar over a review queue.
 *
 * ── Why the checkboxes are not inside this component ──
 *
 * They cannot be. Each card already contains its own decision form, and wrapping the list in a second
 * form would nest them — invalid HTML that browsers resolve by dropping the inner ones, so a per-card
 * Reject would silently submit the bulk form instead. The boxes therefore live in the cards and point
 * here with `form="<formId>"`, which is what the attribute is for: an input may belong to a form it is
 * not inside.
 *
 * So this component owns the form, the note, the buttons and the report; the parent owns the rows and
 * asks `isSelected` / `onToggle` for each. One source of truth for the selection, in the parent, because
 * "select all" and the per-row boxes have to agree.
 *
 * ── The bar is not sticky ──
 *
 * It sits above the list. A pinned bar is a new convention for one screen, and the thing a reviewer needs
 * after clicking is the *report*, not the button — so on a result the bar scrolls itself into view
 * instead, which works the same whether they ticked the first row or the last.
 */
export function BulkDecideBar<S extends { ok: boolean } | null>({
  formId,
  action,
  state,
  selected,
  total,
  onSelectAll,
  onClear,
  cap,
  nouns,
  labelFor,
  nightlyRate,
}: {
  /** Matches the `form=` attribute on every checkbox in the list. */
  formId: string;
  action: (payload: FormData) => void;
  state: S;
  selected: readonly string[];
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  cap: number;
  nouns: { one: string; many: string };
  /** For naming a skipped row the list already rendered. */
  labelFor: (id: string) => string | undefined;
  /** Proposals only: how many drafts the nightly job creates. */
  nightlyRate?: number;
}) {
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /*
   * The note needs the React 19 workaround.
   *
   * React empties an uncontrolled form once its action resolves — success or failure — and a rejection
   * reason typed once for twenty merchants must not evaporate because one row had already moved. The
   * per-card forms in this codebase do lose their note today; this follows the editors that got it right.
   */
  const draft = useFormDraft();

  /*
   * On a result: close the panel and show the outcome.
   *
   * Closing matters more than it sounds. The selection is cleared once a decision lands, so a panel left
   * open re-renders its own heading as "Reject 0 proposals" directly above the report saying two were
   * rejected — which reads as a failure. Observed exactly that before this line existed.
   *
   * Only on `ok`: a refused submission leaves the panel open with the typed note intact, which is the
   * whole point of the draft above.
   *
   * `behavior: 'auto'` rather than smooth — this is not the place to animate at somebody who asked for
   * reduced motion.
   */
  useEffect(() => {
    if (!state) return;
    if (state.ok) setMode(null);
    barRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [state]);

  const count = selected.length;
  const overCap = count > cap;
  const noun = count === 1 ? nouns.one : nouns.many;

  return (
    <div ref={barRef} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm text-ink-900" data-numeric>
          <span className="font-semibold">{count}</span> of {total} selected
        </p>

        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelectAll}
            disabled={count === total}
          >
            Select all {total}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={count === 0}>
            Clear
          </Button>
        </div>

        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            disabled={count === 0 || overCap}
            onClick={() => setMode(mode === 'approve' ? null : 'approve')}
          >
            Approve {count > 0 ? count : ''}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={count === 0 || overCap}
            onClick={() => setMode(mode === 'reject' ? null : 'reject')}
          >
            Reject {count > 0 ? count : ''}
          </Button>
        </div>
      </div>

      {/*
        The cap, stated only once it bites.
        It equals the page size, so this is reachable only if the page ever renders more than the cap —
        which would be a bug rather than an operator's mistake. Saying so is cheaper than debugging it.
      */}
      {overCap && (
        <Alert tone="error">
          {count} selected, and {cap} is the most one decision may carry. Clear some and go again.
        </Alert>
      )}

      {/*
        The form is **always** in the DOM, even with no panel open.

        It holds only the decision and the note; the ids arrive from the checkboxes, which point at it with
        `form="<id>"`. That attribute resolves against a form that exists *now* — so rendering the form only
        once a mode is chosen left every box bound to nothing until the moment the panel opened, which a
        check confirmed by reading `input.form === null`. It happened to work, because the association is
        re-resolved before submit, but "works because the panel opened first" is not a property worth
        relying on. Present and empty is stable.
      */}
      <form
        action={action}
        id={formId}
        key={draft.attempt}
        className={cn(
          'flex flex-col gap-3',
          mode && !overCap && 'rounded-lg border border-line bg-cream p-4',
        )}
      >
        <input type="hidden" name="decision" value={mode ?? 'approve'} />

        {mode && !overCap && (
          <>
            <p className="text-sm font-medium text-ink-900">
              {mode === 'approve'
                ? `Approve ${count} ${noun}.`
                : `Reject ${count} ${noun}. Every one of these merchants gets the same reason.`}
            </p>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">
                {mode === 'approve' ? 'Note (optional)' : 'Why these are rejected'}
              </span>
              <textarea
                name="note"
                rows={3}
                required={mode === 'reject'}
                minLength={mode === 'reject' ? 5 : 0}
                defaultValue={draft.text('note', '')}
                className="rounded-md border border-line-strong bg-surface p-2.5 text-sm"
              />
              <span className="text-xs text-ink-600">
                {mode === 'approve'
                  ? 'The merchants read this. One note for the whole selection.'
                  : 'The merchants read this, so it has to make sense to all of them. At least five characters.'}
              </span>
            </label>

            <div className="flex gap-2">
              <SubmitButton
                size="sm"
                variant={mode === 'reject' ? 'destructive' : 'primary'}
                loadingLabel={mode === 'approve' ? 'Approving…' : 'Rejecting…'}
                disabled={count === 0}
              >
                {mode === 'approve' ? `Approve ${count}` : `Reject ${count}`}
              </SubmitButton>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form>

      <BulkReport state={state} labelFor={labelFor} nightlyRate={nightlyRate} />
    </div>
  );
}

/**
 * What happened, per row where it did not.
 *
 * `role="status"` and `aria-live="polite"`: this arrives without a navigation and is the entire point of
 * the interaction, so a screen reader has to be told. Whole-action failures are an `Alert` instead, which
 * carries `role="alert"` — the distinction is between "here is the outcome" and "nothing happened".
 */
function BulkReport<S extends { ok: boolean } | null>({
  state,
  labelFor,
  nightlyRate,
}: {
  state: S;
  labelFor: (id: string) => string | undefined;
  nightlyRate?: number;
}) {
  if (!state) return null;

  if (!state.ok) {
    const error = (state as { error?: string }).error;
    return (
      <Alert tone="error">
        {error === 'admin.errors.forbidden'
          ? 'Deciding these needs the product-manager capability.'
          : 'Nothing was decided. A reason of at least five characters is required to reject.'}
      </Alert>
    );
  }

  const report = (state as unknown as { data: BulkDecision }).data;
  const proposal = report as BulkProposalDecision;
  const followUp = nightlyRate === undefined ? [] : proposalFollowUp(proposal, nightlyRate);
  const nothing = report.decided === 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-lg border p-4 text-sm',
        nothing ? 'border-warning/40 bg-warning/5' : 'border-forest-500/40 bg-forest-50/50',
      )}
    >
      <p className="flex items-start gap-2 font-medium text-ink-900">
        {nothing ? (
          <X className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <Check className="mt-0.5 size-4 shrink-0 text-forest-700" aria-hidden="true" />
        )}
        {bulkHeadline(report)}
      </p>

      {followUp.map((line) => (
        <p key={line} className="mt-1.5 text-ink-900">
          {line}
        </p>
      ))}

      {report.skipped.length > 0 && (
        <>
          <p className="mt-2.5 text-ink-900">
            {nothing
              ? `All ${report.skipped.length} moved since this page loaded. Reload and look again.`
              : `${report.skipped.length} were left as they were:`}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {report.skipped.map((skip) => (
              <li key={skip.id} className="text-ink-600">
                {/*
                  The label the list already rendered wins over the one the action read back: the reviewer
                  is looking at the former, and a row that vanished has no label from the server at all.
                */}
                <span className="font-medium text-ink-900">
                  {labelFor(skip.id) ?? skip.label ?? skip.id.slice(0, 8)}
                </span>{' '}
                — {SKIP_REASONS[skip.reason]}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The checkbox that goes in a card, pointing at the bar's form. */
export function BulkCheckbox({
  formId,
  fieldName,
  id,
  label,
  checked,
  onToggle,
}: {
  formId: string;
  fieldName: string;
  id: string;
  label: string;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-900">
      <input
        type="checkbox"
        /*
         * `form` is load-bearing, not cosmetic: this input sits inside the card's own decision form, and
         * without the attribute it would submit with that one instead.
         */
        form={formId}
        name={fieldName}
        value={id}
        checked={checked}
        onChange={() => onToggle(id)}
        className="size-4 rounded-[3px] border border-line-strong"
      />
      <span className="sr-only">Select {label}</span>
    </label>
  );
}
