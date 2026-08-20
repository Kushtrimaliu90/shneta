'use client';

import * as React from 'react';
import { useSubmitted } from '@/components/ui/action-form';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — 44px touch target, radius-sm, `line-strong` border.
 *
 * The border is `line-strong` (3.92:1) and not `line` (1.17:1): an input boundary is a UI
 * component under WCAG SC 1.4.11 and must clear 3:1 (docs/13 §C). Focus styling comes from
 * the global `:focus-visible` rule.
 *
 * ── It refills itself after a rejected submission ──
 *
 * Inside an `<ActionForm>` whose action is wrapped in `keepSubmitted`, an input reads what was posted
 * under its own `name` and uses it as `defaultValue`. That is what keeps a form filled in when it was
 * submitted before the page hydrated, where no client-side repair is possible (docs/13 §AW).
 *
 * It costs the call site nothing, which is the point: every field built from `Input` is covered, and
 * a field added later is covered the day it is added rather than the day somebody remembers to wire
 * it. Outside such a form, or on a successful submission, nothing changes.
 */
export function Input({
  className,
  type,
  // Taken out of the spread on purpose: it is resolved below, and leaving it in `props` would let the
  // spread put the caller's seeded value back over what was actually submitted.
  defaultValue,
  ...props
}: React.ComponentProps<'input'>) {
  const resubmit = useSubmitted(props.name, undefined);

  /*
   * A controlled input is React's to own — supplying `defaultValue` alongside `value` is an error.
   * Checkboxes and radios carry their state in `checked`, not `value`, so they are left to
   * `useSubmittedChecked` at the call site.
   */
  const controlled = props.value !== undefined;
  const stateful = type === 'checkbox' || type === 'radio';

  return (
    <input
      type={type}
      defaultValue={resubmit !== undefined && !controlled && !stateful ? resubmit : defaultValue}
      className={cn(
        'h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base text-ink-900 placeholder:text-ink-500',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        'aria-[invalid=true]:border-2 aria-[invalid=true]:border-error',
        className,
      )}
      {...props}
    />
  );
}
