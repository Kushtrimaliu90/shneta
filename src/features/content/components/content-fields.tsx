'use client';

import { Alert } from '@/components/ui/alert';
import type { ContentErrorKey, ContentState } from '@/features/content/editor-actions';

export const CONTENT_ERRORS: Record<ContentErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.content.errors.checkFields': 'Check the fields marked below.',
  'admin.content.errors.slugTaken': 'Another article already uses that address.',
  'admin.content.errors.notFound': 'That entry no longer exists.',
  // The specific reason arrives in `fieldErrors._form` and is rendered under this line.
  'admin.content.errors.removeBlocked': 'This cannot be removed yet.',
};

export const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900 disabled:opacity-60';
export const areaClass =
  'mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink-900';
export const labelClass = 'block text-xs font-medium text-ink-900';

export function fieldError(state: ContentState, field: string): string | null {
  if (!state || state.ok) return null;
  return state.fieldErrors?.[field]?.[0] ?? null;
}

export function formError(state: ContentState): string | null {
  if (!state || state.ok) return null;
  if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) return null;
  return CONTENT_ERRORS[state.error as ContentErrorKey];
}

export function Feedback({ state, saved }: { state: ContentState; saved?: string }) {
  const error = formError(state);
  return (
    <>
      {state?.ok && (
        <Alert tone="success" className="mt-3">
          {saved ?? 'Saved.'}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </>
  );
}

/**
 * One field in both locales, side by side.
 *
 * The pair is a single component because the rule about them is a pair rule: Albanian is
 * required and English is optional (docs/06 §13). Two independent fields would let a screen be
 * built where that is not visible, and an editor would fill in English first.
 */
export function BilingualField({
  name,
  label,
  sq,
  en,
  state,
  multiline,
  rows = 4,
  required,
  hint,
}: {
  name: string;
  label: string;
  sq: string;
  en: string;
  state: ContentState;
  multiline?: boolean;
  rows?: number;
  required?: boolean;
  hint?: string;
}) {
  const sqName = `${name}Sq`;
  const enName = `${name}En`;
  const sqError = fieldError(state, sqName);

  return (
    <fieldset className="mt-4">
      <legend className={labelClass}>
        {label}
        {required && <span className="text-error"> *</span>}
      </legend>
      {hint && <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>}

      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={sqName} className="text-[11px] font-semibold text-ink-500 uppercase">
            Albanian
          </label>
          {multiline ? (
            <textarea
              id={sqName}
              name={sqName}
              rows={rows}
              defaultValue={sq}
              required={required}
              aria-invalid={sqError ? true : undefined}
              className={areaClass}
            />
          ) : (
            <input
              id={sqName}
              name={sqName}
              defaultValue={sq}
              required={required}
              aria-invalid={sqError ? true : undefined}
              className={inputClass}
            />
          )}
          {sqError && <p className="mt-1 text-[13px] text-error">{sqError}</p>}
        </div>

        <div>
          <label htmlFor={enName} className="text-[11px] font-semibold text-ink-500 uppercase">
            English <span className="font-normal normal-case">(optional)</span>
          </label>
          {multiline ? (
            <textarea id={enName} name={enName} rows={rows} defaultValue={en} className={areaClass} />
          ) : (
            <input id={enName} name={enName} defaultValue={en} className={inputClass} />
          )}
        </div>
      </div>
    </fieldset>
  );
}

/**
 * A multi-select rendered as checkboxes, posting one comma-joined hidden value.
 *
 * A native `<select multiple>` is the obvious control and is genuinely hard to use — on a phone
 * it is a scroll trap, and with a keyboard it silently deselects everything the moment you
 * arrow without holding a modifier. Checkboxes cost more pixels and no mistakes.
 */
export function RelatedPicker({
  name,
  label,
  options,
  selected,
}: {
  name: string;
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
}) {
  if (options.length === 0) return null;

  return (
    <fieldset className="mt-4">
      <legend className={labelClass}>{label}</legend>
      <div className="mt-1 flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto rounded-sm border border-line bg-cream p-2.5">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-1.5 text-sm text-ink-900">
            <input
              type="checkbox"
              name={name}
              value={option.id}
              defaultChecked={selected.includes(option.id)}
              className="size-4 rounded-sm border-line-strong"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
