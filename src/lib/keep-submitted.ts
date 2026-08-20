import type { ActionResult } from '@/lib/result';

/**
 * Makes a Server Action hand back what was submitted whenever it fails.
 *
 * ── Why this has to run on the server ──
 *
 * `<ActionForm>` keeps a rejected form filled in by snapshotting the fields in the browser. That
 * covers every submission made after the page has hydrated, which is very nearly all of them — but
 * a form submitted **before** hydration posts natively, and there is no client involved to restore
 * anything. Measured on sign-in: filling and clicking on `domcontentloaded` loses the email, the
 * same sequence after hydration keeps it (docs/13 §AW).
 *
 * The only thing that can repopulate that render is the server, so the values have to travel back in
 * the result and reach the fields as `defaultValue`. Which is also why wrapping cannot happen in the
 * client component: without JavaScript the browser posts straight to the action, and a wrapper
 * defined next to `useActionState` would never run. It belongs in `actions.ts`, around the export.
 *
 * ```ts
 * export const signIn = keepSubmitted(async (previous: FormState, formData: FormData) => { … });
 * ```
 *
 * ── What is left out, deliberately ──
 *
 *   * **Passwords.** They would otherwise be written into the HTML of the response — a real
 *     regression next to the minor convenience of not retyping one. Anything whose field name looks
 *     like a password or a token is dropped.
 *   * **Files.** A `FileList` cannot be assigned to an input by any means; the browser owns it.
 *
 * Values are kept as `string[]` per name so a checkbox group sharing a name survives intact.
 */

/** Dropped before anything leaves the server. Matched case-insensitively against the field name. */
const SECRET = /pass|secret|token|otp|cvv|card/i;

export function submittedValues(formData: FormData): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== 'string') continue; // a File — cannot be seeded back
    if (SECRET.test(name)) continue;
    (values[name] ??= []).push(value);
  }
  return values;
}

/**
 * Wraps an action so its failures carry `submitted`. Successes are returned untouched — a form that
 * succeeded should clear, and echoing a placed order's details back into the fields would suggest it
 * still needed submitting.
 */
export function keepSubmitted<S, R extends ActionResult<unknown, string> | null>(
  action: (previous: S, formData: FormData) => Promise<R>,
): (previous: S, formData: FormData) => Promise<R> {
  return async (previous, formData) => {
    const result = await action(previous, formData);
    if (result && result.ok === false) {
      return { ...result, submitted: submittedValues(formData) };
    }
    return result;
  };
}
