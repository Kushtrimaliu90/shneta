import { safeNextPath } from '@/features/auth/schemas';

/**
 * Email links, verified by token hash rather than by PKCE code (docs/05 §15.3).
 *
 * ── The bug this exists to fix ──
 *
 * `@supabase/ssr` uses the **PKCE** flow. Asking for a magic link generates a secret *code verifier*
 * and stores it in a cookie **in the browser that asked**. The link carries only a `code`, which is
 * worthless without that verifier — so `exchangeCodeForSession` can only succeed on the same device.
 *
 * Reported from real use: request a sign-in link on a PC, open it on the phone where the mail app
 * lives, and the phone gets "that link is no longer valid". Nothing had expired. The verifier was on
 * the PC.
 *
 * And it was never only about magic links. **Every** email link went through the same route: password
 * recovery, signup confirmation, email change, and the seller invitation — which a merchant is more
 * likely to open on a phone than anywhere else. A customer resetting a password on a laptop and
 * opening the mail on their phone has been hitting this the whole time.
 *
 * ── The fix ──
 *
 * `{{ .TokenHash }}` with `verifyOtp` instead of `{{ .ConfirmationURL }}` with
 * `exchangeCodeForSession`. A token hash is verified against the server directly, so it carries no
 * device-bound secret and works wherever it is opened. This is what Supabase documents for
 * server-side rendering, and the reason it documents it is exactly this failure.
 *
 * OAuth keeps PKCE and keeps `/api/auth/callback`. There the flow *starts* in a browser and returns to
 * it moments later, so device binding is a security property rather than an obstacle — and Google
 * would not accept a token hash anyway.
 */

/**
 * The verification types this route will act on.
 *
 * An allowlist, not a pass-through. `type` arrives on a query string, `verifyOtp` accepts more values
 * than these (including phone types), and a mismatched type against a real token is an error the
 * visitor cannot act on. Anything unrecognised is refused before it reaches Supabase.
 */
export const EMAIL_LINK_TYPES = [
  'magiclink',
  'signup',
  'recovery',
  'invite',
  'email_change',
  /*
   * `email` is what Supabase sends for the *second* leg of an email change — the confirmation to the
   * new address. Omitting it means a customer who changes their address is told their link is invalid.
   */
  'email',
] as const;

export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export function isEmailLinkType(value: string | null): value is EmailLinkType {
  return value !== null && (EMAIL_LINK_TYPES as readonly string[]).includes(value);
}

/**
 * Where each kind of link should land when it has no explicit `next`.
 *
 * The templates pass `next` themselves, so this is a floor rather than the usual path — but a
 * hand-edited template that drops the parameter should still leave people somewhere sensible instead
 * of on the account page holding a password they have not set.
 */
export function defaultNextFor(type: EmailLinkType): string {
  switch (type) {
    case 'recovery':
    case 'invite':
      // Both arrive at a password they need to choose.
      return '/auth/reset-password';
    default:
      return '/account';
  }
}

/** The absolute URL an email template should point at, for a given link type. */
export function emailLinkUrl(siteUrl: string, type: EmailLinkType, next?: string | null): string {
  const target = safeNextPath(next, defaultNextFor(type));
  return `${siteUrl}/api/auth/confirm?type=${type}&next=${encodeURIComponent(target)}`;
}
