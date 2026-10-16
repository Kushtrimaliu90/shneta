import { createHash, randomBytes } from 'node:crypto';

/**
 * docs/18 — the shape of a merchant API key, and the two things done to one.
 *
 * Pure, no Supabase, so it is unit-testable and so the integration suite can mint a key the same way
 * the portal does. The database stores only `hashApiKey(token)`; `merchant_api_exec` recomputes the
 * same SHA-256 over the same bytes, which is the whole contract between this file and the migration.
 *
 * ── The format ──
 *
 *   bck_live_<43 characters of base64url>
 *
 * The prefix makes a key recognisable in a config file or a log line (`bck_` is this shop; `live` leaves
 * room for a sandbox tier that does not exist yet). 32 random bytes is 256 bits — guessing is not a
 * threat model, which is why the route's rate limit on failed attempts is a courtesy rather than a
 * defence.
 */

export const API_KEY_PREFIX = 'bck_live_';

/** How much of the token the portal shows afterwards. Enough to tell keys apart, never enough to use. */
const VISIBLE_CHARS = 4;

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex, which is what `merchant_api_keys.key_hash` holds and what the SQL recomputes. */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** `bck_live_ab12` — the visible head of a token, for the keys table and for `me`. */
export function apiKeyPrefix(token: string): string {
  return token.slice(0, API_KEY_PREFIX.length + VISIBLE_CHARS);
}

/**
 * A cheap shape check before the database is asked. A bearer value that is obviously not one of our
 * tokens — the wrong prefix, the wrong length — is refused without a round trip, which keeps a scanner
 * sending `Bearer admin` from costing a query each time.
 */
export function looksLikeApiKey(value: string): boolean {
  return /^bck_live_[A-Za-z0-9_-]{43}$/.test(value);
}

/** The bearer token from an `Authorization` header, or null when there is none worth looking at. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && looksLikeApiKey(token) ? token : null;
}

/**
 * A webhook signing secret (docs/18 §3.6): `whsec_` + 43 characters of base64url. Minted here, stored
 * in the clear so it can sign, and returned to the merchant once on creation or rotation.
 */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}
