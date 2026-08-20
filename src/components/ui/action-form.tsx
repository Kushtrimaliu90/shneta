'use client';

import { useEffect, useRef } from 'react';

/**
 * A `<form>` that does not throw away what the customer typed when the action fails.
 *
 * ── The bug this exists for ──
 *
 * Reported from real use: a customer filled in checkout, the coupon was rejected for not meeting its
 * minimum, the error appeared correctly — and **every field was empty**. Name, phone, address, all of
 * it, to be typed again.
 *
 * It is not a checkout bug. Reproduced on `/auth/sign-in` with a wrong password: the email field is
 * cleared too. React 19 **resets uncontrolled fields in a `<form action={fn}>` after the action
 * completes**, and it has no notion of success or failure — a rejected coupon and a placed order are
 * the same event to it. So every form on the site behaved this way.
 *
 * ── Not the same job as `useFormDraft` ──
 *
 * `use-form-draft.ts` solves this for the admin editors, and it is the right tool there: an editor's
 * fields default from a **saved record**, so it has to tell three states apart — the rejected draft, the
 * record to fall back to, and a value the operator deliberately cleared. That needs per-field wiring
 * (`draft.text('slug', product.slug)`) and it handles checkbox groups, which editors are full of.
 *
 * The forms here have no saved record behind them. Checkout, sign-up, contact, a review: the fields are
 * empty or seeded from the session, and "give back exactly what was submitted" is the whole
 * requirement. That needs no wiring at all, so it should not carry any.
 *
 * Pick by that question — is there a record behind these fields? If yes, use the hook.
 *
 * ── Why a component and not a per-field fix ──
 *
 * The sanctioned alternative is to return the submitted values from the action and feed them back as
 * `defaultValue` on every input. That works, but it is a change to each action, each schema and each
 * field — and the failure mode is silent: add a field later, forget the wiring, and it quietly starts
 * losing data again. One component that restores whatever was in the form cannot miss a field, and
 * converting a form is a one-line change.
 *
 * ── The rule that makes restoring safe ──
 *
 * **A field is only touched when the DOM disagrees with what was submitted.** A controlled input is
 * driven by React state, which the reset does not touch, so React re-asserts its value before this runs
 * and it always already agrees — meaning this can never clobber one. An uncontrolled input is the only
 * kind that can disagree, which is exactly the case worth fixing. No detection of "controlled vs
 * uncontrolled" is needed; the disagreement is the discriminator.
 *
 * Deliberately out of scope:
 *
 *   * **Passwords.** Conventionally cleared after a failed attempt, and a password is quick to retype
 *     compared with an address.
 *   * **Checkboxes, radios and selects.** One click each, and they are the controls most likely to be
 *     React-controlled here — the shipping-method radio in checkout is. Restoring a checked state
 *     without telling React would leave the DOM and the state disagreeing, which is a worse bug than
 *     the one being fixed.
 *   * **File inputs.** A `FileList` cannot be assigned; the browser forbids it.
 *
 * ── The un-hydrated case ──
 *
 * A form submitted before this component has mounted is not covered — there is no snapshot to restore
 * from. That is the progressive-enhancement path the forms here deliberately support, and fixing it
 * needs the values to come back from the server in the action result. Worth doing for checkout
 * specifically if it ever proves to matter; for everybody else, this runs.
 */

/** Restored only for these. `type` is absent on a plain text input, hence the empty string. */
const RESTORABLE_INPUT_TYPES = new Set([
  '',
  'text',
  'email',
  'tel',
  'url',
  'number',
  'search',
  'date',
]);

/**
 * Every restorable field at submit time, including the ones submitted empty.
 *
 * The empty entries are not padding. A field seeded from the session — `defaultEmail` on checkout —
 * that the customer deliberately clears is reset by React back to that stale seeded value, not to
 * empty. Knowing the field existed and was submitted empty is what separates "clear it again" from
 * "this field appeared after the failure, leave it alone".
 */
type Snapshot = Map<string, string>;

function keyFor(el: HTMLInputElement | HTMLTextAreaElement, index: number): string {
  // Name is the stable identity; the index disambiguates the rare same-name pair.
  return `${el.name || '?'}::${index}`;
}

function restorable(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return RESTORABLE_INPUT_TYPES.has(el.type === 'textarea' ? 'text' : el.type);
}

function snapshotOf(form: HTMLFormElement): Snapshot {
  const snapshot: Snapshot = new Map();
  [...form.querySelectorAll('input, textarea')].forEach((el, index) => {
    if (!restorable(el)) return;
    snapshot.set(keyFor(el, index), el.value);
  });
  return snapshot;
}

function restoreInto(form: HTMLFormElement, snapshot: Snapshot): void {
  [...form.querySelectorAll('input, textarea')].forEach((el, index) => {
    if (!restorable(el)) return;

    const submitted = snapshot.get(keyFor(el, index));
    // Absent means the field was not on screen at submit time — none of this applies to it.
    if (submitted === undefined) return;

    if (el.value === '' && submitted !== '') {
      el.value = submitted; // The reset emptied it. Put back what was typed.
    } else if (el.value !== '' && submitted === '') {
      /*
       * Submitted empty but now showing something: the reset put a seeded `defaultValue` back into a
       * field the customer had cleared on purpose. Leaving it would show an address or an email they
       * had removed, and on checkout that is an order shipped to the wrong place.
       */
      el.value = '';
    }
  });
}

/**
 * True when a server action reported failure.
 *
 * Every action on the site returns `ActionResult` (docs/02 §7), so one check covers all of them
 * without each caller having to describe its own state shape.
 */
function isFailure(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'ok' in state &&
    (state as { ok: unknown }).ok === false
  );
}

export function ActionForm({
  action,
  state,
  children,
  ...rest
}: {
  /** The dispatch from `useActionState`. */
  action: (formData: FormData) => void;
  /** The state from `useActionState`. Restores whenever this becomes a failure. */
  state: unknown;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<'form'>, 'action'>) {
  const formRef = useRef<HTMLFormElement>(null);
  const snapshot = useRef<Snapshot | null>(null);

  /*
   * Captured in the capture phase, so it runs before React hands the submission to the action and
   * therefore before anything is reset.
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const capture = () => {
      snapshot.current = snapshotOf(form);
    };
    form.addEventListener('submit', capture, true);
    return () => form.removeEventListener('submit', capture, true);
  }, []);

  /*
   * Keyed on the state object itself rather than on a boolean: two consecutive failures produce two
   * different objects but the same `true`, and a boolean dependency would skip the second restore.
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form || !snapshot.current || !isFailure(state)) return;
    restoreInto(form, snapshot.current);
  }, [state]);

  return (
    <form ref={formRef} action={action} {...rest}>
      {children}
    </form>
  );
}
