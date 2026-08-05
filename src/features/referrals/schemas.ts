import { z } from 'zod';

/**
 * docs/17 §1 — invite codes.
 *
 * The authority on what a code is remains `public.normalize_referral_code()`: this is the same rule,
 * applied early so a typo is caught while the person who can fix it is still looking at the field.
 * The two must agree, and the unit test checks them against the same table of inputs.
 */

/** The generator's alphabet — no `I`, `O`, `0`, `1`, `S` or `5` to be misread. */
const CODE_BODY = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;

/**
 * Whatever was typed or pasted → `BIO-XXXXX`, or null.
 *
 * Accepts the whole share link because that is what people paste. Somebody sent a WhatsApp message
 * containing `https://biocode.fit/r/BIO-K7F2M`; the recipient copies the message, not the five
 * characters inside it, and a field that rejects the thing it told them to click is a field that
 * loses referrals.
 *
 * Accepts the bare body for the same reason it is unambiguous in SQL: `BIO` cannot occur inside a
 * code, because `I` and `O` are not in the alphabet.
 */
export function normalizeReferralCode(input: string): string | null {
  const fromLink = /\/r\/([^/?#\s]+)/i.exec(input);
  const clean = (fromLink?.[1] ?? input).toUpperCase().replace(/[^A-Z0-9]/g, '');

  const body =
    clean.length === 8 && clean.startsWith('BIO')
      ? clean.slice(3)
      : clean.length === 5
        ? clean
        : null;

  return body && CODE_BODY.test(body) ? `BIO-${body}` : null;
}

/**
 * A code that must be present and must look like one.
 *
 * `?? ''` is unreachable — the refine above it has already established that the normaliser returns a
 * string — and is written rather than a cast because a cast to silence the compiler is exactly what
 * CLAUDE.md §1 rules out. Same shape as `phoneSchema` in the auth feature.
 */
export const referralCodeSchema = z
  .string()
  .trim()
  .min(1, 'REQUIRED')
  .max(64)
  .refine((value) => normalizeReferralCode(value) !== null, { message: 'INVALID_REFERRAL_CODE' })
  .transform((value) => normalizeReferralCode(value) ?? '');

/**
 * The same code, optional.
 *
 * An empty field is not an error: the invite code is optional at sign-up, and a blank one means
 * "nobody invited me" rather than "you forgot something".
 *
 * The trailing `.optional()` is load-bearing and not decoration. In Zod 4 a `.transform()` produces a
 * pipe, and a pipe is non-optional even when its input union accepts `undefined` — so listing
 * `z.undefined()` inside the union parses a *present* undefined but still rejects a key that is
 * missing entirely. `.optional()` is what makes the key itself optional.
 */
export const optionalReferralCodeSchema = z
  .union([referralCodeSchema, z.literal('')])
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const claimReferralCodeSchema = z.object({
  code: referralCodeSchema,
});
