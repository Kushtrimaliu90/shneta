import { sameAmount, toCents } from '@/lib/money';
import { DIETARY_TAGS, PRODUCT_FORMS } from '@/features/catalog/admin-copy';
import { slugSchema } from '@/features/catalog/admin-schemas';
import type { Database } from '@/lib/supabase/database.types';

/**
 * What a single cell of an uploaded catalogue means.
 *
 * These are the rules an operator actually collides with — a comma decimal, a status they are not allowed to
 * set from a file, a tag they invented — and they live here rather than in `sheet-import.ts` because that
 * file is `server-only`: it opens a Supabase client at the top of `importProducts`, so a test that wanted to
 * ask "is `1.234,50` refused?" would have to mock a database to find out. Split out, each rule is a function
 * of its arguments and the answer is checkable. Same split as `pending-queues.ts` beside `pending.ts`.
 *
 * Every verdict carries the sentence the operator will read. Keeping the message next to the rule is the
 * point: the two cannot drift, and the report the route renders is not assembled from codes somewhere else.
 */

/** `same` means the cell asks for nothing — not that it was empty. */
export type CellVerdict<T> =
  | { kind: 'same' }
  | { kind: 'set'; value: T }
  | { kind: 'refuse'; problem: string };

export type MoneyVerdict =
  | { kind: 'same' }
  /** An emptied optional amount — distinct from `set`, because null is not a number. */
  | { kind: 'clear' }
  | { kind: 'set'; cents: number }
  | { kind: 'refuse'; problem: string };

type ProductForm = Database['public']['Enums']['product_form'];

/** The statuses a file may set. `published` is absent on purpose — see `readStatusCell`. */
export const SHEET_STATUSES = ['draft', 'pending_review', 'archived'] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];

/** `yes`/`no`/`true`/`1`/`po`/`jo` — whatever somebody typed in a boolean cell. */
export function readBoolean(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'po'].includes(text)) return true;
  if (['no', 'n', 'false', '0', 'jo'].includes(text)) return false;
  return null;
}

/** A comma list, trimmed and de-duplicated, order preserved. */
export function readList(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

/**
 * A price cell.
 *
 * Compared as an **amount**, not as text. The export writes `10.90`, Excel stores the number `10.9`, and the
 * reader gives back `"10.9"` — so a string comparison reported a price change on every variant of an
 * untouched file. That is the one thing this feature must never do: a diff full of changes nobody made is a
 * diff nobody reads.
 *
 * `toCents` is the authority on what parses, and it refuses rather than guesses — `9,90` is fine, while
 * `1.234,50` and anything with three decimals is rejected. That refusal is what protects against a locale
 * decimal producing a price a hundred times too high.
 */
export function readMoneyCell(
  raw: string,
  currentValue: string,
  options: { required: boolean },
): MoneyVerdict {
  const text = raw.trim();
  if (sameAmount(text, currentValue)) return { kind: 'same' };

  if (text === '') {
    if (options.required) return { kind: 'refuse', problem: 'A variant needs a price.' };
    return { kind: 'clear' };
  }

  let cents: number;
  try {
    cents = toCents(text);
  } catch {
    return {
      kind: 'refuse',
      problem: `"${text}" is not an amount. Write it like 9,90 or 9.90, with no thousands separator.`,
    };
  }
  if (cents <= 0) return { kind: 'refuse', problem: `"${text}" is not a price above zero.` };
  return { kind: 'set', cents };
}

/**
 * A status cell.
 *
 * Publishing is refused rather than allowed-with-a-warning, because a published product is a health claim in
 * front of a customer and the approval checklist is the gate. A file that could flip that gate would make
 * the checklist advisory.
 */
export function readStatusCell(raw: string, current: string): CellVerdict<SheetStatus> {
  const next = raw.trim().toLowerCase();
  if (next === current) return { kind: 'same' };
  if (next === 'published') {
    return {
      kind: 'refuse',
      problem:
        'A product cannot be published from a file — compliance has to approve it. Set draft, pending_review or archived.',
    };
  }
  if (!(SHEET_STATUSES as readonly string[]).includes(next)) {
    return { kind: 'refuse', problem: `"${next}" is not a status. Use draft, pending_review or archived.` };
  }
  // Narrowed by the allow-list above, which is also the message the operator sees.
  return { kind: 'set', value: next as SheetStatus };
}

/** A slug cell. Immutable once published (CLAUDE.md §10), so the refusal is about the product, not the text. */
export function readSlugCell(
  raw: string,
  current: string,
  options: { published: boolean },
): CellVerdict<string> {
  const next = raw.trim();
  if (next === current) return { kind: 'same' };
  if (options.published) {
    return {
      kind: 'refuse',
      problem: 'The web address is locked once a product is published, and this one is live.',
    };
  }
  if (!slugSchema.safeParse(next).success) {
    return {
      kind: 'refuse',
      problem: `"${next}" is not a valid web address — lowercase letters, numbers and single hyphens.`,
    };
  }
  return { kind: 'set', value: next };
}

/** A form cell. Empty is allowed and means "unset" — the column is nullable. */
export function readFormCell(raw: string, current: string): CellVerdict<ProductForm | null> {
  const next = raw.trim().toLowerCase();
  if (next === current) return { kind: 'same' };
  if (next && !(PRODUCT_FORMS as readonly string[]).includes(next)) {
    return { kind: 'refuse', problem: `"${next}" is not a form. Use one of: ${PRODUCT_FORMS.join(', ')}.` };
  }
  return { kind: 'set', value: (next || null) as ProductForm | null };
}

/** A dietary-tags cell. Replace-all, like the editor's checkboxes. */
export function readTagsCell(raw: string, current: string): CellVerdict<string[]> {
  const next = readList(raw).map((tag) => tag.toLowerCase());
  const unknown = next.filter((tag) => !(DIETARY_TAGS as readonly string[]).includes(tag));
  if (unknown.length > 0) {
    return {
      kind: 'refuse',
      problem: `Not a dietary tag: ${unknown.join(', ')}. Allowed: ${DIETARY_TAGS.join(', ')}.`,
    };
  }
  if (next.join(',') === readList(current).join(',')) return { kind: 'same' };
  return { kind: 'set', value: next };
}
