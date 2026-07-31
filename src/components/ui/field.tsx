import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A labelled form control with its error wired up.
 *
 * docs/04 §10 requires every input to carry a real `<label>` (never placeholder-as-label)
 * and docs/09 §4 requires the error to be programmatically associated. Doing that by hand
 * at every call site is how `aria-describedby` ends up missing on the one field that fails
 * validation, so it lives here instead.
 */
interface FieldProps {
  id: string;
  label: string;
  /** Rendered under the label, before the control. For format rules and the like. */
  hint?: string;
  errors?: string[];
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    required: boolean;
  }) => React.ReactNode;
}

export function Field({
  id,
  label,
  hint,
  errors,
  required = false,
  className,
  children,
}: FieldProps) {
  const hasError = Boolean(errors && errors.length > 0);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
        {required && (
          <span className="ml-0.5 text-error" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-[13px] text-ink-500">
          {hint}
        </p>
      )}

      {children({
        id,
        'aria-invalid': hasError,
        'aria-describedby': describedBy || undefined,
        required,
      })}

      {hasError && (
        <p id={errorId} className="text-[13px] text-error">
          {errors?.join(' ')}
        </p>
      )}
    </div>
  );
}
