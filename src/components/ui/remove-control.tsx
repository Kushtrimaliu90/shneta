'use client';

import { useActionState, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { FormLevelErrors } from '@/components/ui/field-error';
import { cn } from '@/lib/utils';

/**
 * Removing a record, and putting it back.
 *
 * One control for products, brands, categories and articles, because the interaction is identical and
 * four copies would drift — one would forget the confirmation, one would forget to say the removal is
 * reversible.
 *
 * ── Why the confirmation says what it says ──
 *
 * "Are you sure?" asks a question the operator cannot answer from what is on screen. This names the thing
 * and states the one fact that decides it: **nothing is destroyed and it can be put back.** That is true
 * here — removal sets a timestamp, the row keeps its slug, and Restore clears it — so saying so is not
 * reassurance, it is the relevant information.
 *
 * A refusal is not a failure to hide. When the rules say no, they say why and what to do instead, and
 * that arrives in `fieldErrors._form` from the action — see `features/catalog/removal.ts`.
 */

/**
 * What these actions return, narrowed to the two facts this control needs.
 *
 * Concrete rather than generic: every removal action returns its own keyed error union, and a generic
 * parameter made the two casts below unprovable while adding nothing — the control reads `ok`, `error`
 * and `fieldErrors`, and nothing else.
 */
export type RemoveState =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  | null;

/**
 * `previous: null` in the signature, not the action's own state type.
 *
 * Every one of these actions names its first argument `_previous` and ignores it, so this passes `null`
 * and does not pretend to thread state it never reads. Contravariance makes that assignable from any
 * action whose state union includes `null`, which all of them do.
 */
export type RemoveAction = (previous: null, formData: FormData) => Promise<RemoveState>;

export function RemoveControl({
  action,
  hiddenFields,
  label,
  noun,
  errorCopy,
  consequences,
  size = 'sm',
}: {
  action: RemoveAction;
  /** The ids the action needs, as `name -> value`. */
  hiddenFields: Record<string, string>;
  /** What is being removed, named, so the confirmation is about a thing and not about a row. */
  label: string;
  noun: string;
  /** Turns the action's error key into a sentence. */
  errorCopy: Record<string, string>;
  /** Anything an operator would not guess — a merchant offer going unsellable, say. */
  consequences?: string[];
  size?: 'sm' | 'md';
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction] = useActionState<RemoveState, FormData>(async (_previous, formData) => {
    const result = await action(null, formData);
    // Closed only on success: a refusal must stay on screen with its reason.
    if (result?.ok) setAsking(false);
    return result;
  }, null);

  const failed = state !== null && !state.ok;
  const fieldErrors = failed ? (state.fieldErrors ?? {}) : {};
  const errorKey = failed ? state.error : null;

  return (
    <div className="flex flex-col gap-2">
      {!asking && (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={() => setAsking(true)}
          className="text-error hover:bg-error/10"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remove
        </Button>
      )}

      {asking && (
        <form action={formAction} className="rounded-md border border-error/40 bg-error/5 p-3">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          <p className="text-sm text-ink-900">
            Remove <span className="font-semibold">{label}</span>?
          </p>
          <p className="mt-1 text-xs text-ink-600">
            It leaves the shop and this panel straight away. Nothing is deleted — you can put it back, and
            it keeps its web address in the meantime.
          </p>

          {consequences && consequences.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs text-ink-900">
              {consequences.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            <SubmitButton size="sm" variant="destructive" loadingLabel="Removing…">
              Remove {noun}
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {failed && errorKey && (
        <Alert tone="error">
          {errorCopy[errorKey] ?? 'That did not work.'}
          <FormLevelErrors errors={fieldErrors} />
        </Alert>
      )}
    </div>
  );
}

/**
 * Put back what was removed.
 *
 * No confirmation: restoring is not destructive, and a record comes back at whatever status it held —
 * which for products and articles is never `published`, because the removal refused that. So there is no
 * way for this button to put something on the storefront by surprise.
 */
export function RestoreControl({
  action,
  hiddenFields,
  errorCopy,
  className,
}: {
  action: RemoveAction;
  hiddenFields: Record<string, string>;
  errorCopy: Record<string, string>;
  className?: string;
}) {
  const [state, formAction] = useActionState<RemoveState, FormData>(
    async (_previous, formData) => action(null, formData),
    null,
  );

  const failed = state !== null && !state.ok;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <form action={formAction}>
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <SubmitButton size="sm" variant="secondary" loadingLabel="Restoring…">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Restore
        </SubmitButton>
      </form>

      {failed && (
        <p role="alert" className="text-xs text-error">
          {errorCopy[state.error] ?? 'That did not work.'}
        </p>
      )}
    </div>
  );
}
