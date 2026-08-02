/** docs/05 §9 — at most four products line up before the table stops being readable. */
export const COMPARE_MAX = 4;

/**
 * The cookie the selection lives in.
 *
 * Not `httpOnly`: the toggle is client state and the point of the cookie is that it survives a
 * navigation, not that it is a credential. It holds product ids and nothing else — losing it,
 * or having it read, costs a visitor nothing.
 *
 * The URL is the other half (`/compare?ids=…`), and it is the authoritative one: docs/05 §9
 * requires the table to be shareable, so a link someone was sent must win over whatever happens
 * to be in the recipient's cookie.
 */
export const COMPARE_COOKIE = 'biocode_compare';
export const COMPARE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Servings per pack, read out of the serving-size text.
 *
 * docs/05 §9 asks for a computed price per serving, and nothing in the schema stores a pack
 * count — `serving_size` is free text like "2 capsules daily, 60 per pack". So this looks for a
 * number followed by "per pack" / "për paketë" and returns `null` when it cannot find one, which
 * the table renders as "—".
 *
 * A guess would be worse than a blank. Price per serving is the number a shopper uses to decide
 * which of two products is cheaper, and one derived from a misparsed pack size is not a rough
 * answer, it is a wrong one.
 *
 * Here rather than in `queries.ts` because that file is `server-only` and this is pure parsing —
 * which also means it can be unit-tested without a database.
 */
export function servingsFrom(servingSize: string | null): number | null {
  if (!servingSize) return null;
  const match =
    /(\d{1,4})\s*(?:[a-zçëA-ZÇË]+\s+)?(?:per pack|për paketë|ne paketë|në paketë)/i.exec(
      servingSize,
    );
  const value = match?.[1] ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Parses a comma-separated id list from a cookie or a query string, bounded and de-duplicated. */
export function parseCompareIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    // Ids only. Anything else came from a hand-edited URL and is dropped rather than queried.
    if (!/^[0-9a-f-]{36}$/i.test(id) || seen.includes(id)) continue;
    seen.push(id);
    if (seen.length === COMPARE_MAX) break;
  }
  return seen;
}
