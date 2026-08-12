'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import {
  removeProductsBulk,
  restoreProductsBulk,
  type BulkRemoveState,
} from '@/features/catalog/admin-actions';
import { cn } from '@/lib/utils';

/**
 * Selecting several products and removing — or restoring — them together.
 *
 * ── Why the checkboxes are rendered by the page and not here ──
 *
 * The list is a Server Component `<table>`, and it should stay one: it is URL-driven, works without
 * JavaScript, and an operator can send "everything still in draft" as a link. Wrapping it in a client
 * component to own a checkbox would trade all of that for a tick box.
 *
 * So this owns the selection and the form, and the page renders a `<SelectBox>` per row pointing at it
 * with `form="bulk-products"`. That attribute exists exactly for this: an input may belong to a form it
 * is not inside — which is also what keeps it out of the row's own controls.
 *
 * ── One bar, two verbs ──
 *
 * The same selection can be removed or restored; which is offered depends on the view, because the
 * Removed tab and the live list never contain the same row. Passing `mode` rather than rendering two
 * bars keeps the selection state single, which is what makes "select all" and the row boxes agree.
 */

const FORM_ID = 'bulk-products';

export function ProductBulkBar({
  ids,
  mode,
  cap,
}: {
  /** Every row on screen, in order, so "select all" means exactly what is visible. */
  ids: string[];
  mode: 'remove' | 'restore';
  cap: number;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  /*
   * Intersected with what is on screen every render. A revalidation drops removed rows out of the list,
   * and an id that no longer exists must not sit in the set inflating the count or riding along in the
   * next submission.
   */
  const present = useMemo(() => new Set(ids), [ids]);
  const live = useMemo(() => selected.filter((id) => present.has(id)), [selected, present]);

  const [state, action] = useActionState<BulkRemoveState, FormData>(async (previous, formData) => {
    const result = await (mode === 'remove'
      ? removeProductsBulk(previous, formData)
      : restoreProductsBulk(previous, formData));
    // Cleared only when something moved; a refused selection stays put so it can be looked at.
    if (result?.ok && result.data.removed > 0) setSelected([]);
    return result;
  }, null);

  // Publishes the selection to the row checkboxes without a context: see `SelectBox` below.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bulk-products:selection', { detail: live }));
  }, [live]);

  useEffect(() => {
    function onToggle(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      setSelected((current) =>
        current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
      );
    }
    window.addEventListener('bulk-products:toggle', onToggle);
    return () => window.removeEventListener('bulk-products:toggle', onToggle);
  }, []);

  const count = live.length;
  const overCap = count > cap;
  const verb = mode === 'remove' ? 'Remove' : 'Restore';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm text-ink-900" data-numeric>
          <span className="font-semibold">{count}</span> of {ids.length} selected
        </p>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSelected(ids)}
          disabled={count === ids.length}
        >
          Select all {ids.length}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSelected([])}
          disabled={count === 0}
        >
          Clear
        </Button>

        <form action={action} id={FORM_ID} className="ml-auto">
          <SubmitButton
            size="sm"
            variant={mode === 'remove' ? 'destructive' : 'secondary'}
            disabled={count === 0 || overCap}
            loadingLabel={mode === 'remove' ? 'Removing…' : 'Restoring…'}
          >
            {mode === 'remove' ? (
              <Trash2 className="size-3.5" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-3.5" aria-hidden="true" />
            )}
            {verb} {count > 0 ? count : ''}
          </SubmitButton>
        </form>
      </div>

      {overCap && (
        <Alert tone="error">
          {count} selected, and {cap} is the most one go may carry. Clear some and repeat.
        </Alert>
      )}

      {mode === 'remove' && count > 0 && !overCap && (
        <p className="text-xs text-ink-600">
          {/*
            Said before the click rather than in a dialog after it. A published product is refused by the
            action, so a mixed selection partly succeeds — and knowing that in advance is the difference
            between a surprising result and an expected one.
          */}
          Nothing is deleted — removed products keep their web address and can be restored. Anything live
          on the site is skipped and reported.
        </p>
      )}

      <BulkResult state={state} />
    </div>
  );
}

/** What happened, and per row where it did not. */
function BulkResult({ state }: { state: BulkRemoveState }) {
  if (!state) return null;

  if (!state.ok) {
    return <Alert tone="error">{CATALOG_ERRORS[state.error]}</Alert>;
  }

  const { removed, requested, skipped } = state.data;
  const nothing = removed === 0;

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
        {nothing ? 'Nothing changed.' : `${removed} of ${requested} done.`}
      </p>

      {skipped.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {skipped.map((row) => (
            <li key={row.id} className="text-ink-600">
              <span className="font-medium text-ink-900">{row.label}</span> — {row.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One row's checkbox.
 *
 * ── Why this talks to the bar through a window event ──
 *
 * The bar and the rows are siblings under a Server Component, so there is no shared React tree to put a
 * context provider in — and lifting the table into a client component to get one would cost the whole
 * server-rendered, URL-driven, no-JavaScript table for a tick box. A pair of events on `window` is the
 * smaller price, and it is scoped by a name nothing else uses.
 *
 * `form` is what makes the value reach the bar's submission at all: the input is inside a `<td>`, not
 * inside the form.
 */
export function SelectBox({ id, label }: { id: string; label: string }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    function onSelection(event: Event) {
      setChecked((event as CustomEvent<string[]>).detail.includes(id));
    }
    window.addEventListener('bulk-products:selection', onSelection);
    return () => window.removeEventListener('bulk-products:selection', onSelection);
  }, [id]);

  return (
    <label className="flex cursor-pointer items-center">
      <input
        type="checkbox"
        form={FORM_ID}
        name="productIds"
        value={id}
        checked={checked}
        onChange={() =>
          window.dispatchEvent(new CustomEvent('bulk-products:toggle', { detail: id }))
        }
        className="size-4 rounded-[3px] border border-line-strong"
      />
      <span className="sr-only">Select {label}</span>
    </label>
  );
}
