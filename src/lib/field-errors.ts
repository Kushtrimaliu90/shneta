/**
 * Turning a Zod failure into per-field messages an operator can act on.
 *
 * ── Why not `flatten().fieldErrors` ──
 *
 * Because it only names TOP-LEVEL keys. Probed against this project's Zod (4.4.3) with the real
 * product schema: a bilingual field with an empty Albanian name and an over-long English one produces
 *
 *     { name: ['REQUIRED', 'Too big: expected string to have <=160 characters'] }
 *
 * Two problems in one object and no way to tell which of the two inputs each belongs to, so neither can
 * be marked. `issue.path.join('.')` gives `name.sq` and `name.en` instead — which is exactly what the
 * `name` attributes in the product editor are called, so the lookup needs no mapping table at all.
 *
 * The same trap was hit and documented for the homepage intent band (docs/13); this is that fix
 * extracted so the next form does not have to rediscover it.
 *
 * ── Why the messages are translated here ──
 *
 * Zod's own text is written for whoever wrote the schema, not for whoever filled the form: the probe
 * above returned `Too big: expected string to have <=160 characters`, `Invalid option: expected one of
 * "capsule"|"tablet"`, and `Invalid UUID`. And this project deliberately uses custom messages as
 * machine codes (`REQUIRED`, `SLUG_INVALID`), which are worse — they would put a constant name in front
 * of an operator.
 *
 * So a `copy` map keyed by the raw message converts the codes, and anything it does not name falls back
 * to a sentence derived from the issue's own `code`. Nothing reaches a screen untranslated.
 */

/**
 * The shape this needs from a Zod issue, declared structurally rather than imported.
 *
 * `ZodIssue` is a discriminated union whose member names moved between Zod 3 and 4, and this module
 * only ever reads three fields plus two optional numbers. A structural type keeps `lib/` a dependency
 * leaf — it does not import zod at all — and means a Zod upgrade cannot break it.
 */
export interface FieldIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly message: string;
}

/** The key used for a problem that belongs to the form as a whole rather than to one input. */
export const FORM_LEVEL = '_form';

/**
 * Path-keyed messages, ready to render.
 *
 * Several issues can land on one field — `slug` can be both too short and badly formatted — so values
 * are arrays and every message is kept. A form that reports one problem at a time is a form somebody
 * submits four times.
 */
export function fieldErrorsFrom(
  issues: readonly FieldIssue[],
  copy: Readonly<Record<string, string>> = {},
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = pathKey(issue.path);
    const message = copy[issue.message] ?? describe(issue);
    errors[key] = [...(errors[key] ?? []), message];
  }

  return errors;
}

/**
 * `['name', 'sq'] → 'name.sq'`, and `[] → '_form'`.
 *
 * Symbol segments are dropped rather than stringified: `join` throws outright on a symbol
 * ("Cannot convert a Symbol value to a string"), and a thrown error while *reporting* a validation
 * error would replace a fixable form with a crash. No schema here uses symbol keys; this is so that
 * one added later degrades instead of exploding.
 */
function pathKey(path: readonly PropertyKey[]): string {
  const parts = path.filter(
    (segment): segment is string | number =>
      typeof segment === 'string' || typeof segment === 'number',
  );
  return parts.length === 0 ? FORM_LEVEL : parts.join('.');
}

/**
 * A sentence for an issue the caller's `copy` map did not name.
 *
 * Keyed on `code` rather than on message text, because codes are stable across Zod's wording changes.
 * The numbers come off the issue so the message can say *how* long is too long — "too long" alone
 * leaves an operator trimming by guesswork.
 */
function describe(issue: FieldIssue): string {
  const bounds = issue as FieldIssue & { maximum?: unknown; minimum?: unknown };
  const maximum = typeof bounds.maximum === 'number' ? bounds.maximum : null;
  const minimum = typeof bounds.minimum === 'number' ? bounds.minimum : null;

  switch (issue.code) {
    case 'too_big':
      return maximum === null ? 'Too long.' : `Too long — ${maximum} characters at most.`;

    /*
     * `min(1)` is how "required" is spelled in Zod, so a bound of 1 or less is not a length
     * complaint and must not be reported as one.
     */
    case 'too_small':
      return minimum === null || minimum <= 1 ? 'Required.' : `At least ${minimum} characters.`;

    /*
     * A missing field arrives as `invalid_type` (undefined where a string was expected), which is
     * the same thing as empty from the operator's point of view.
     */
    case 'invalid_type':
      return 'Required.';

    case 'invalid_value':
    case 'invalid_enum_value':
      return 'Choose one of the listed options.';

    // `invalid_format` covers uuid, email, regex and url. Which one it was is a schema detail; what
    // the operator needs is that this particular box is wrong, and the `copy` map sharpens the ones
    // where a specific sentence helps.
    case 'invalid_format':
      return 'Not in the expected format.';

    /*
     * Anything else — most usefully `custom`, which is what `.refine()` produces.
     *
     * Here the issue's own message is the best available text: a `refine` message was written by hand
     * for exactly this situation, so replacing it with a generic sentence throws away the only specific
     * thing on offer. Caught by a test that fed in a `custom` issue reading "Two things clash." and got
     * "Not valid." back.
     *
     * The exception is this project's habit of using SCREAMING_SNAKE codes *as* messages. Those are
     * handled by the `copy` map above, but a new one on an unrecognised code would otherwise leak
     * straight to the screen — which is the whole defect being fixed — so a bare code is refused and
     * falls through to the generic sentence instead.
     *
     * `invalid_union` also lands here, and is unreachable from a form: every `FormData` value is a
     * string, so `z.string().optional().or(z.literal(''))` only reports a union error when handed a
     * non-string. Probed against 4.4.3 — an over-long string through that same union reports a plain
     * `too_big` carrying `maximum`, which the branch above answers properly.
     */
    default:
      return looksLikeCode(issue.message) ? 'Not valid.' : issue.message;
  }
}

/** `SLUG_INVALID` yes, `Two things clash.` no. */
function looksLikeCode(message: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(message);
}

/**
 * Whether any reported field sits inside a group — used to decide whether to open a collapsed
 * section or switch tabs so the operator can actually see what is marked.
 *
 * Prefix match on the dotted path: `startsWith('name')` would also match `nameOfSomethingElse`, so
 * the boundary is checked explicitly.
 */
export function hasErrorUnder(
  fieldErrors: Readonly<Record<string, string[]>>,
  prefix: string,
): boolean {
  return Object.keys(fieldErrors).some((key) => key === prefix || key.startsWith(`${prefix}.`));
}
