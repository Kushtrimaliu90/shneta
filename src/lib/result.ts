/**
 * The server-action contract (docs/02 §7). Every mutation returns this shape —
 * never a thrown error, never a bare boolean.
 *
 * `E` is the error type, and it exists so a feature can narrow it to its own union of
 * **i18n message keys** rather than bare `string`. Callers then render with
 * `t(result.error)` and the compiler proves the key exists (CLAUDE.md §3) — a typo becomes
 * a build failure instead of a blank error message in front of a customer.
 *
 * `lib/` stays a dependency leaf: the key union is declared by the feature, not here.
 */
export type ActionResult<T = void, E extends string = string> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: E;
      fieldErrors?: Record<string, string[]>;
      /**
       * What the caller submitted, so a rejected form can be redrawn with it still filled in.
       *
       * React 19 empties an uncontrolled `<form action={fn}>` once the action resolves and does not
       * look at what came back (docs/13 §AW), and `<ActionForm>` repairs that in the browser. This
       * field is what covers the case `<ActionForm>` cannot: a form submitted **before the page has
       * hydrated** posts natively, so there is no client to restore anything — the values have to
       * arrive from the server as `defaultValue`.
       *
       * Attached by `keepSubmitted` (`src/lib/keep-submitted.ts`), never by hand. Values are
       * `string[]` per name because a checkbox group shares one name and `Object.fromEntries` would
       * keep only the last — the mistake documented in `use-form-draft.ts`.
       *
       * Password fields are stripped before this leaves the server.
       */
      submitted?: Record<string, string[]>;
    };

/**
 * Returns the success branch precisely — `{ ok: true; data: T }` rather than the full
 * union. That makes it assignable to `ActionResult<T, E>` for *any* `E`: a success carries
 * no error, so it should not force the caller to name an error type.
 */
export function ok(): { ok: true; data: void };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T): { ok: true; data: T | void } {
  return { ok: true, data: data as T };
}

export function fail<E extends string, T = void>(
  error: E,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T, E> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/**
 * Narrows a Zod flattened error into the `fieldErrors` shape.
 * Kept here so `actions.ts` files never hand-roll it.
 */
export function fromFieldErrors<E extends string, T = void>(
  error: E,
  flattened: { fieldErrors: Record<string, string[] | undefined> },
): ActionResult<T, E> {
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(flattened.fieldErrors)) {
    if (value && value.length > 0) fieldErrors[key] = value;
  }
  return fail<E, T>(error, Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined);
}

export function isOk<T, E extends string>(
  result: ActionResult<T, E>,
): result is { ok: true; data: T } {
  return result.ok;
}
