/**
 * Recent searches, in a cookie.
 *
 * ── A cookie, and read on the client ──
 *
 * The brief specifies a cookie rather than localStorage, and this is one. What it deliberately is *not*
 * is a cookie the **server** reads: `navbar.tsx` documents that one `cookies()` call in the header opts
 * every catalogue page out of static rendering, and that already happened once (docs/13 §M1). The
 * storage medium is exactly as asked; only the access is client-side, which is what keeps the shop
 * statically cached.
 *
 * Kept small on purpose. A cookie rides on **every** request to the origin, including images and RSC
 * payloads, so five short queries is a few hundred bytes of permanent overhead and fifty would be a
 * self-inflicted performance tax. The cap is the design, not a placeholder.
 */

export const RECENT_COOKIE = 'biocode_recent_searches';
const MAX_RECENT = 5;
const MAX_LENGTH = 40;
const ONE_YEAR = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function readRecentSearches(): string[] {
  const raw = readCookie(RECENT_COOKIE);
  if (!raw) return [];

  /*
   * Newline-separated rather than JSON. A cookie value has to be URL-encoded anyway, and JSON's braces
   * and quotes each become three characters once encoded — on a value that travels with every request,
   * that is most of the budget spent on punctuation.
   */
  return raw
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_RECENT);
}

export function pushRecentSearch(query: string): void {
  if (typeof document === 'undefined') return;

  const trimmed = query.trim().slice(0, MAX_LENGTH);
  if (trimmed.length < 2) return;

  // Case-insensitive dedupe, most recent first: searching the same thing twice should move it to the
  // top rather than appear twice and push something else out.
  const existing = readRecentSearches().filter(
    (entry) => entry.toLowerCase() !== trimmed.toLowerCase(),
  );
  const next = [trimmed, ...existing].slice(0, MAX_RECENT);

  document.cookie = `${RECENT_COOKIE}=${encodeURIComponent(next.join('\n'))}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`;
}

export function clearRecentSearches(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${RECENT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
