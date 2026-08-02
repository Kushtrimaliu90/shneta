/**
 * docs/08 §7 — the words that turn a supplement description into a medicine claim.
 *
 * Two lists, deliberately, because they are used for different things.
 *
 * `CLAIMS_REMINDER` in `features/catalog/taxonomy-config.ts` is advisory: shown beside a product
 * description so the person writing it has the rule in view, never enforced, because a blocklist
 * is trivially defeated by a synonym and rejects legitimate sentences ("does not treat").
 *
 * This one is enforced, and only on one surface: the BioHack "PSE" copy. docs/15 §4 asks for a
 * hard block there and the difference is worth stating. A product description is written once,
 * read by a compliance manager, and approved before it ships. A protocol block's copy is
 * generated *at* a customer, recombined with fifteen others, and never read as a whole page by
 * anyone — so the reviewer who would catch "kuron" in a description does not exist here.
 *
 * Both locales, because the Albanian is what the market reads and an English-only list would
 * check the half of the copy that fewer customers see.
 */

const BANNED = [
  // English
  'cure',
  'cures',
  'cured',
  'treat',
  'treats',
  'treated',
  'treatment',
  'prevent',
  'prevents',
  'prevented',
  'heal',
  'heals',
  'healed',
  'diagnose',
  'diagnoses',
  'diagnosis',
  // Albanian
  'kuron',
  'kurojnë',
  'mjekon',
  'mjekojnë',
  'parandalon',
  'parandalojnë',
  'shëron',
  'shërojnë',
  'diagnostikon',
] as const;

/**
 * The pattern, built once from the list.
 *
 * `\b` on both sides so "treatment" is caught but "retreat" is not — and note that the list
 * carries inflections explicitly rather than using a `\w*` suffix, which would swallow
 * "prevention of oxidation" alongside the claim it is meant to catch.
 *
 * Unicode-aware: `ë` and `ç` are word characters under `u`, and without the flag `\b` would
 * split "shëron" in the middle and match nothing.
 */
const PATTERN = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'iu');

/** Every banned word present in the text, lowercased and deduplicated. Empty when clean. */
export function findBannedClaims(text: string): string[] {
  const found = new Set<string>();
  for (const word of BANNED) {
    if (new RegExp(`\\b${word}\\b`, 'iu').test(text)) found.add(word);
  }
  return [...found];
}

/** True when the text makes a claim that must not ship. */
export function hasBannedClaim(text: string): boolean {
  return PATTERN.test(text);
}

export const BANNED_CLAIM_WORDS: readonly string[] = BANNED;
