import { describe, expect, it } from 'vitest';
import { parseClientEnv } from '@/lib/env.client';

/**
 * docs/10 §3 — the app fails fast on missing or malformed required vars rather than
 * surfacing `undefined` deep inside a Supabase call.
 *
 * Only the client parser is exercised here: importing `env.server.ts` would pull in
 * `server-only`, which throws by design outside a server context.
 */
const VALID = {
  NEXT_PUBLIC_SITE_URL: 'https://biocode.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
};

describe('parseClientEnv', () => {
  it('accepts a complete public environment', () => {
    expect(parseClientEnv(VALID)).toEqual(VALID);
  });

  it('names every missing variable in one throw', () => {
    expect(() => parseClientEnv({})).toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(() => parseClientEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('rejects a site URL that is not a URL', () => {
    expect(() => parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: 'biocode.com' })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  /**
   * A trailing slash is normalised away, not rejected.
   *
   * Every consumer builds `${origin}/path`, so one invisible character at the end of a Vercel setting put
   * `https://www.shtrejt.com//` in the live sitemap as the canonical home page, `//shop` on every product
   * URL, `//en` as the English alternate, and `//api/auth/callback` in the address Supabase was asked to
   * redirect to. `z.url()` accepts it, so nothing failed and nothing warned.
   *
   * Normalised rather than refused because a value that differs from the intended one by a slash should mean
   * what the person obviously meant, not fail a production deploy.
   */
  it('strips a trailing slash from the site URL', () => {
    expect(parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: 'https://biocode.com/' })).toEqual(
      VALID,
    );
    expect(parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: 'https://biocode.com///' })).toEqual(
      VALID,
    );
  });

  it('leaves a path-bearing origin alone apart from the trailing slash', () => {
    expect(
      parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: 'https://biocode.com/shop/' })
        .NEXT_PUBLIC_SITE_URL,
    ).toBe('https://biocode.com/shop');
  });

  it('rejects a truncated anon key', () => {
    expect(() => parseClientEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'short' })).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  /**
   * The message is the product here, not just the throw.
   *
   * A Vercel build failed on a missing `NEXT_PUBLIC_SITE_URL`, and the log said "check these
   * variables against .env.example" — advice that is useless to the person reading it, who is in
   * a browser on a settings page with no repository open. These assertions pin the three things
   * that turn the failure into a fix.
   */
  describe('the failure message', () => {
    it('distinguishes "not set" from "set to the wrong shape"', () => {
      expect(() => parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: undefined })).toThrow(
        /NEXT_PUBLIC_SITE_URL — not set/,
      );

      // A bare host is the mistake people actually make; it must not read as "not set".
      let message = '';
      try {
        parseClientEnv({ ...VALID, NEXT_PUBLIC_SITE_URL: 'www.shtrejt.com' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/NEXT_PUBLIC_SITE_URL/);
      expect(message).not.toMatch(/NEXT_PUBLIC_SITE_URL — not set/);
    });

    it('shows what a valid value looks like', () => {
      expect(() => parseClientEnv({})).toThrow(/the scheme is required/);
    });

    it('says the variables are read at build time', () => {
      expect(() => parseClientEnv({})).toThrow(/BUILD time/);
    });

    /**
     * Names and reasons, never values. Build logs get pasted into chats and screenshots far more
     * casually than a `.env` file does; these three are public by design, but that is not the
     * same as being worth reprinting.
     */
    it('never echoes the offending value', () => {
      let message = '';
      try {
        parseClientEnv({
          ...VALID,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'leaky-value-should-not-appear',
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toContain('leaky-value-should-not-appear');
    });
  });
});
