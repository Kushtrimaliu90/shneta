import { FORM_LEVEL } from '@/lib/field-errors';

/**
 * The message under one input, and the wiring that ties it to the input.
 *
 * Three things have to agree for a marked field to be usable by everybody: the input carries
 * `aria-invalid`, it points at this element with `aria-describedby`, and the text is actually rendered.
 * Doing that by hand at twenty inputs is how a form ends up with a red border and no explanation, so
 * `fieldProps` below produces the attributes and this renders the matching element.
 */
export function FieldError({
  name,
  errors,
}: {
  name: string;
  errors: Readonly<Record<string, string[]>>;
}) {
  const messages = errors[name];
  if (!messages || messages.length === 0) return null;

  return (
    <p id={errorId(name)} className="mt-1 text-xs font-medium text-error">
      {messages.join(' ')}
    </p>
  );
}

/**
 * Problems that belong to no single input — an object-level `refine`, say — which would otherwise be
 * computed and never rendered, because no input has that name to look them up.
 */
export function FormLevelErrors({ errors }: { errors: Readonly<Record<string, string[]>> }) {
  const messages = errors[FORM_LEVEL];
  if (!messages || messages.length === 0) return null;

  return (
    <ul className="mt-2 list-disc pl-5 text-sm text-error">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/** Stable id so `aria-describedby` and the element that answers it cannot drift apart. */
export function errorId(name: string): string {
  /*
   * Dots are legal in an id and in a CSS `[id="..."]` selector, but not in a bare `#id` one — and a
   * bilingual field is genuinely called `name.sq`. Replaced so the id stays selectable everywhere,
   * including in a test.
   */
  return `err-${name.replace(/\./g, '-')}`;
}

/**
 * The attributes an input needs to be *marked* rather than merely wrong.
 *
 * `aria-invalid` only when there is a message: setting it unconditionally announces every untouched
 * field on the form as invalid the moment one of them fails.
 */
export function fieldProps(
  name: string,
  errors: Readonly<Record<string, string[]>>,
): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return errors[name]?.length ? { 'aria-invalid': true, 'aria-describedby': errorId(name) } : {};
}

/** The red ring on a marked input, so the class list is written once. */
export function invalidRing(name: string, errors: Readonly<Record<string, string[]>>): string {
  return errors[name]?.length ? 'border-error ring-1 ring-error' : '';
}
