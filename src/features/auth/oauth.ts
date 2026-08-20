import { safeNextPath } from '@/features/auth/schemas';

/**
 * Social sign-in, the parts that are pure logic (docs/05 §15).
 *
 * Split out from the route handler so the two things worth getting wrong can be tested without a
 * browser or a Supabase project: which providers are allowed, and where the provider is told to send
 * the visitor back.
 *
 * ── Why a GET route and an anchor, rather than a button and `signInWithOAuth` in the browser ──
 *
 * Two reasons, and the first is the one that would have bitten.
 *
 *   1. **CSP.** `next.config.ts` sets `form-action 'self'`. A button that POSTs to a server action
 *      which then 302s to Google is a form submission whose redirect chain leaves the origin, and
 *      browsers disagree about whether `form-action` follows redirects. A link is a navigation, not a
 *      form submission, so the directive does not apply and nothing has to be loosened.
 *   2. **It works before hydration.** Every other auth form on the site is a real `<form action>` that
 *      submits without JavaScript (docs/05 §15). A social button that needs React to have mounted
 *      would be the one control on the page that silently does nothing on a slow connection.
 */

/**
 * The providers this build will start a flow for.
 *
 * An allowlist rather than a pass-through: the value arrives on a query string, and
 * `signInWithOAuth` accepts around twenty provider names. Without this, `?provider=azure` would send
 * a visitor to a half-configured provider and return them to a generic failure — or worse, succeed,
 * and create an account through a channel nobody had thought about.
 *
 * Apple is deliberately absent until the Services ID, the domain-association file and the private-key
 * rotation exist (see the notes in docs/13 §AR). Adding it here is the whole code change.
 */
export const OAUTH_PROVIDERS = ['google'] as const;

/**
 * The providers actually offered to a visitor right now.
 *
 * Separate from the allowlist above on purpose. The allowlist says what this build *understands*, so
 * the route can reject `?provider=azure` outright; this says what is *configured*, so a button is
 * never shown for a provider that would bounce the visitor back with an error. A flag off means the
 * block renders nothing at all — no empty divider, no lone terms notice.
 */
export function enabledOAuthProviders(flags: { google: boolean }): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter((provider) => flags[provider]);
}

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string | null): value is OAuthProvider {
  return value !== null && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Where the provider sends the visitor once they have agreed.
 *
 * The absolute origin comes from `NEXT_PUBLIC_SITE_URL` rather than from the incoming request, so a
 * host header cannot redirect the code somewhere else. The path is the callback that already exists
 * for email links, which is registered with Supabase and excluded from the intl middleware — one
 * redirect URL serves both locales.
 *
 * `next` is passed through `safeNextPath`, which is what stops `?next=https://evil.example` from
 * turning a sign-in into an open redirect.
 */
export function oauthRedirectUrl(siteUrl: string, next?: string | null): string {
  const target = safeNextPath(next);
  return `${siteUrl}/api/auth/callback?next=${encodeURIComponent(target)}`;
}
