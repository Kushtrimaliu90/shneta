/**
 * The server-action contract (docs/02 §7). Every mutation returns this shape —
 * never a thrown error, never a bare boolean.
 */
export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | void> {
  return { ok: true, data: data as T };
}

export function fail<T = void>(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/**
 * Narrows a Zod flattened error into the `fieldErrors` shape.
 * Kept here so `actions.ts` files never hand-roll it.
 */
export function fromFieldErrors<T = void>(
  error: string,
  flattened: { fieldErrors: Record<string, string[] | undefined> },
): ActionResult<T> {
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(flattened.fieldErrors)) {
    if (value && value.length > 0) fieldErrors[key] = value;
  }
  return fail<T>(error, Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined);
}

export function isOk<T>(result: ActionResult<T>): result is { ok: true; data: T } {
  return result.ok;
}
