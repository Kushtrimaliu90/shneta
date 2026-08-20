import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OAUTH_PROVIDERS,
  enabledOAuthProviders,
  isOAuthProvider,
  oauthRedirectUrl,
} from '@/features/auth/oauth';
import { defaultNextFor, emailLinkUrl, isEmailLinkType } from '@/features/auth/email-links';

/**
 * Social sign-in, the parts worth guarding (docs/05 §15).
 *
 * Everything here protects against a silent failure rather than a crash. A wrong provider name, a
 * redirect that leaves the origin, or a swallowed PKCE cookie all produce the same symptom — the
 * visitor lands back on the sign-in page — and none of them raise anything a log would catch.
 */

describe('provider allowlist', () => {
  it('accepts only the providers this build has configured', () => {
    expect([...OAUTH_PROVIDERS]).toEqual(['google']);
    expect(isOAuthProvider('google')).toBe(true);
  });

  /*
   * `signInWithOAuth` accepts around twenty provider names, and Supabase happily starts a flow for one
   * that has no credentials configured. The visitor gets an opaque provider-side error page on a
   * domain that is not ours — so the guard is here, not there.
   */
  it('rejects a provider that is merely plausible', () => {
    for (const value of ['azure', 'facebook', 'apple', 'GOOGLE', ' google', '', null]) {
      expect(isOAuthProvider(value)).toBe(false);
    }
  });
});

describe('what is actually offered', () => {
  /*
   * The allowlist and the offer list are separate for a reason: the route must reject an unknown
   * provider even while no provider is configured, and the UI must show nothing while that is true.
   * Conflating them gives a button that starts a flow Supabase has no credentials for, and the visitor
   * blames the shop.
   */
  it('offers nothing until a provider is configured', () => {
    expect(enabledOAuthProviders({ google: false })).toEqual([]);
  });

  it('offers Google once its flag is on', () => {
    expect(enabledOAuthProviders({ google: true })).toEqual(['google']);
  });

  /* Still rejected at the route even when nothing is on offer — the two are independent. */
  it('keeps rejecting unknown providers regardless of the flags', () => {
    expect(isOAuthProvider('azure')).toBe(false);
  });
});

describe('redirect target', () => {
  const site = 'https://biocode.fit';

  it('sends the provider back to the callback that already exists', () => {
    expect(oauthRedirectUrl(site, '/account/orders')).toBe(
      'https://biocode.fit/api/auth/callback?next=%2Faccount%2Forders',
    );
  });

  it('defaults to the account page when no destination is given', () => {
    expect(oauthRedirectUrl(site, null)).toBe(
      'https://biocode.fit/api/auth/callback?next=%2Faccount',
    );
  });

  /*
   * The open-redirect case, which is the one that matters: `next` arrives on a query string that
   * anybody can write, and it is handed to a third party who will send the browser wherever it says.
   */
  it('refuses to carry an off-site destination', () => {
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      expect(oauthRedirectUrl(site, hostile)).toBe(
        'https://biocode.fit/api/auth/callback?next=%2Faccount',
      );
    }
  });

  /*
   * The origin comes from `NEXT_PUBLIC_SITE_URL` rather than from the request, so a forged `Host`
   * header cannot make the provider deliver the authorisation code to another site.
   */
  it('builds the origin from configuration, not from a request', () => {
    expect(oauthRedirectUrl('https://staging.biocode.fit', '/account')).toContain(
      'https://staging.biocode.fit/',
    );
  });
});

/**
 * The PKCE verifier hand-off, asserted against the source.
 *
 * `signInWithOAuth` generates the code verifier and gives it to the cookie adapter; `/api/auth/callback`
 * cannot redeem the code without it. `lib/supabase/server` wraps its cookie writes in an empty
 * `catch {}` — correct there, because it is shared with Server Components where cookies are read-only,
 * and fatal here, because the flow would end at "link_invalid" with nothing logged.
 *
 * A runtime test would need a real Supabase project and a browser. This is the cheap version: it fails
 * if somebody simplifies the route to use the shared client, which is exactly the tidy-up that would
 * reintroduce the bug.
 */
describe('the oauth route keeps its own cookie adapter', () => {
  const source = readFileSync('src/app/api/auth/oauth/route.ts', 'utf8');

  it('does not use the shared server client, whose cookie writes can be swallowed', () => {
    expect(source).not.toContain("from '@/lib/supabase/server'");
    expect(source).toContain('createServerClient');
  });

  it('writes cookies onto the response it returns', () => {
    expect(source).toContain('response.cookies.set');
    // The redirect is a second response, so the cookies have to be copied across explicitly.
    expect(source).toContain('outbound.cookies.set');
  });

  it('lets the route do the redirecting rather than the SDK', () => {
    expect(source).toContain('skipBrowserRedirect: true');
  });

  /*
   * Without `prompt=select_account` Google reuses whichever account is already signed in, so on a
   * shared phone or a shop laptop the second person is silently signed into the first person's
   * BioCode account.
   */
  it('always asks Google which account to use', () => {
    expect(source).toContain("prompt: 'select_account'");
  });
});

/**
 * The name resolution in `handle_new_user`.
 *
 * Asserted against the migration text because the alternative is a live database. The three sources
 * matter for a specific reason each: `full_name` is what the email sign-up action writes and must win;
 * `name` is the OIDC standard claim; `given_name` + `family_name` is the split form, which is the only
 * shape Apple ever sends and it sends it once.
 */
describe('profile name from provider metadata', () => {
  const sql = readFileSync('supabase/migrations/20260820120000_oauth_profile_names.sql', 'utf8');

  it('reads all three shapes, with the typed name first', () => {
    const [full, name, given] = ['full_name', 'name', 'given_name'].map((key) =>
      sql.indexOf(`>>'${key}'`),
    );
    /* CLAUDE.md §1 forbids non-null assertions, so the guard is an assertion rather than a `!`. */
    expect(full).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(-1);
    expect(given).toBeGreaterThan(-1);
    expect(full).toBeLessThan(name as number);
    expect(name).toBeLessThan(given as number);
  });

  /*
   * An empty name is a prompt to fill one in. A name derived from the email local part is a wrong
   * answer that looks like a right one, and it reaches other customers through `mask_person_name`.
   */
  it('never falls back to the email local part', () => {
    expect(sql).not.toMatch(/split_part\s*\(\s*new\.email/i);
  });

  it('keeps the referral link and its exception guard', () => {
    expect(sql).toContain('public.link_referral(new.id, v_code, v_source)');
    expect(sql).toContain('exception when others then');
  });
});

/**
 * The merchant invitation's destination (docs/13 §AT).
 *
 * Asserted against the source because the failure is silent and looks like success: `inviteUserByEmail`
 * with no `redirectTo` sends the invitee to the project's Site URL, so an approved seller landed on the
 * storefront home page — signed in, no password set, nothing pointing at the portal they were invited
 * to. The invite had worked and looked broken.
 */
describe('merchant invitation redirect', () => {
  const source = readFileSync('src/features/merchants/actions.ts', 'utf8');
  const invite = source.slice(source.indexOf('inviteUserByEmail'));
  const call = invite.slice(0, invite.indexOf('});') + 3);

  it('tells Supabase where to send the invitee', () => {
    expect(call).toContain('redirectTo');
  });

  it('routes through the callback that exchanges the code for a session', () => {
    expect(call).toContain('/api/auth/callback');
  });

  it('lands on the set-password page, then the seller portal', () => {
    const context = source.slice(
      source.indexOf('const setPassword'),
      source.indexOf('inviteUserByEmail'),
    );
    expect(context).toContain('/auth/reset-password');
    expect(context).toContain("encodeURIComponent('/merchant')");
  });

  /*
   * The origin is configuration, not the incoming request: a forged Host header must not be able to
   * point an invitation's landing page at another site.
   */
  it('builds the absolute URL from configuration', () => {
    expect(call).toContain('clientEnv.NEXT_PUBLIC_SITE_URL');
  });
});

/**
 * `resetPassword` honouring that destination — the other half of the same fix.
 *
 * The page serves two journeys with different endings: a customer who forgot their password belongs in
 * `/account`, an invited seller in `/merchant`. Sanitised, because `next` arrives from a URL.
 */
describe('set-password destination', () => {
  const source = readFileSync('src/features/auth/actions.ts', 'utf8');
  const action = source.slice(source.indexOf('export const resetPassword'));
  const body = action.slice(0, action.indexOf('\n};'));

  it('redirects to the requested destination, defaulting to the account page', () => {
    expect(body).toContain("safeNextPath(parsed.data.next, '/account?password=updated')");
  });

  it('does not hard-code the account page any more', () => {
    expect(body).not.toContain("localizedRedirect('/account?password=updated')");
  });
});

/**
 * Cross-device email links (docs/13 §AU).
 *
 * The bug: `@supabase/ssr` uses PKCE, so `exchangeCodeForSession` needs a code verifier stored in a
 * cookie **in the browser that asked for the link**. Reported from real use — request a sign-in link on
 * a PC, open it on the phone where the mail app is, and the phone is told the link is no longer valid.
 * Nothing had expired; the verifier was on the PC. It affected every email link, password recovery
 * included.
 */
describe('email links verify by token hash, not PKCE', () => {
  const confirm = readFileSync('src/app/api/auth/confirm/route.ts', 'utf8');
  const callback = readFileSync('src/app/api/auth/callback/route.ts', 'utf8');

  it('the email route verifies a token hash', () => {
    expect(confirm).toContain('verifyOtp');
    expect(confirm).toContain('token_hash');
  });

  /*
   * The whole point: no code verifier means no device binding. Asserted against the *call* rather than
   * the word, because the route's own header comment explains what it replaced and would otherwise
   * fail its own test.
   */
  it('the email route never exchanges a PKCE code', () => {
    expect(confirm).toContain('auth.verifyOtp(');
    expect(confirm).not.toContain('auth.exchangeCodeForSession(');
  });

  /*
   * OAuth keeps PKCE deliberately. The flow leaves for Google and returns to the same browser seconds
   * later, so device binding is a security property there rather than an obstacle.
   */
  it('the OAuth callback keeps PKCE', () => {
    expect(callback).toContain('auth.exchangeCodeForSession(');
    expect(callback).not.toContain('auth.verifyOtp(');
  });

  it('both routes claim a pending referral through the shared helper', () => {
    for (const source of [confirm, callback]) {
      expect(source).toContain('claimReferralFromCookie');
    }
  });
});

describe('email link types', () => {
  it('accepts the five Supabase sends, plus the email-change second leg', () => {
    for (const t of ['magiclink', 'signup', 'recovery', 'invite', 'email_change', 'email']) {
      expect(isEmailLinkType(t)).toBe(true);
    }
  });

  /* `type` arrives on a query string and `verifyOtp` accepts more than these, phone types included. */
  it('refuses anything else', () => {
    for (const t of ['sms', 'phone_change', 'MAGICLINK', '', null]) {
      expect(isEmailLinkType(t)).toBe(false);
    }
  });

  /*
   * Recovery and invite both land on a password the person has to choose. Everything else belongs in
   * the account area. This is only a floor — the templates pass `next` explicitly — but a template
   * edited by hand should not strand somebody.
   */
  it('sends password journeys to the set-password page', () => {
    expect(defaultNextFor('recovery')).toBe('/auth/reset-password');
    expect(defaultNextFor('invite')).toBe('/auth/reset-password');
    expect(defaultNextFor('magiclink')).toBe('/account');
    expect(defaultNextFor('signup')).toBe('/account');
  });

  it('builds a link that cannot be redirected off-site', () => {
    expect(emailLinkUrl('https://biocode.fit', 'magiclink', 'https://evil.example')).toBe(
      'https://biocode.fit/api/auth/confirm?type=magiclink&next=%2Faccount',
    );
    expect(emailLinkUrl('https://biocode.fit', 'recovery', '/auth/reset-password')).toContain(
      'next=%2Fauth%2Freset-password',
    );
  });
});
