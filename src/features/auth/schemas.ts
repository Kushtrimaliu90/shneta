import { z } from 'zod';
import { LOCALES } from '@/lib/constants';
import { optionalReferralCodeSchema } from '@/features/referrals/schemas';

/**
 * docs/02 §7 — schemas are single-sourced here and reused on client and server. The server
 * action re-parses regardless of what the client did: client validation is UX, this is the
 * boundary.
 */

/**
 * docs/05 §12.1 — Kosovo mobile numbers. Accepts `+383…`, `00383…` and the local `0…`
 * form, because customers type all three, and normalises to E.164 so the courier always
 * gets a dialable number.
 */
const KOSOVO_PHONE = /^(?:\+383|00383|0)([1-9]\d{7})$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-()]/g, ''))
  .refine((value) => KOSOVO_PHONE.test(value), { message: 'INVALID_PHONE' })
  .transform((value) => {
    const digits = KOSOVO_PHONE.exec(value)?.[1] ?? '';
    return `+383${digits}`;
  });

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'REQUIRED')
  .max(254)
  .email('INVALID_EMAIL')
  .transform((value) => value.toLowerCase());

/**
 * Length only. Supabase Auth enforces its own project-level policy, and stacking a
 * composition rule on top (upper + digit + symbol) measurably pushes people toward
 * predictable substitutions — NIST 800-63B advises length over composition.
 */
export const passwordSchema = z.string().min(8, 'PASSWORD_TOO_SHORT').max(72, 'PASSWORD_TOO_LONG');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'REQUIRED'),
  next: z.string().optional(),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'REQUIRED').max(120),
  email: emailSchema,
  password: passwordSchema,
  marketingOptIn: z.coerce.boolean().default(false),
  // docs/05 §15 — terms acceptance is explicit and required.
  terms: z.literal('on', { message: 'TERMS_REQUIRED' }),
  /*
   * docs/17 §1 — the invite code, optional.
   *
   * Validated for shape rather than accepted blindly, because a mistyped code is only fixable while
   * the person who typed it is still looking at the field: silently dropping it means the referrer
   * never gets credited and nobody ever finds out why. An empty field is not an error.
   */
  referralCode: optionalReferralCodeSchema,
  next: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * docs/05 §15.2 — a sign-in link, and nothing else.
 *
 * No password, and deliberately no `fullName` or `terms` either: this is a way to sign *in*, never a
 * way to register. See `sendMagicLink` for why that distinction is load-bearing rather than tidy.
 */
export const magicLinkSchema = z.object({
  email: emailSchema,
  next: z.string().optional(),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
    /*
     * Where to land once the password is set.
     *
     * This page serves two journeys that end in different places: a customer who forgot their
     * password belongs back in `/account`, and an approved seller setting their *first* password
     * belongs in `/merchant`. Sanitised through `safeNextPath` like every other `next` on the site.
     */
    next: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'PASSWORDS_DO_NOT_MATCH',
    path: ['confirmPassword'],
  });

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'REQUIRED').max(120),
  phone: z.union([phoneSchema, z.literal('')]).optional(),
  preferredLocale: z.enum(LOCALES),
  marketingOptIn: z.coerce.boolean().default(false),
});

export const changePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'PASSWORDS_DO_NOT_MATCH',
    path: ['confirmPassword'],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Guards against an open redirect on `?next=`.
 *
 * An attacker who can choose the post-login destination can bounce a freshly authenticated
 * customer to a look-alike domain. Only same-site absolute paths are allowed, and `//host`
 * is rejected explicitly because it is protocol-relative and leaves the site.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (next.includes('://')) return fallback;

  /*
   * A backslash is an authority separator in practice, whatever the RFC says.
   *
   * `/\evil.example` passes every check above — it starts with a single slash and contains no
   * `://` — and then Chrome, Firefox and Safari all normalise the backslash to a forward slash, so a
   * `Location: /\evil.example` header is a protocol-relative redirect to `evil.example`. That is an
   * open redirect on the sign-in, sign-up, password-reset and social sign-in paths, every one of
   * which takes `next` from a query string anybody can write.
   *
   * Found by a test written for `oauthRedirectUrl`, which passed `/\evil.example` on the assumption
   * it was already covered here. It was not, and had not been since the function was written.
   *
   * The encoded form needs no separate case: `searchParams.get()` decodes `%5C` before this sees it.
   */
  if (next.includes('\\')) return fallback;

  /*
   * Control characters, which are the other half of the same family: browsers strip or normalise
   * some of them while parsing a URL, so a tab or a newline spliced into the value can survive a
   * naive prefix check and mean something else by the time it is acted on.
   */
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;

  return next;
}
