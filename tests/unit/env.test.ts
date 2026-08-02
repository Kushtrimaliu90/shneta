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

  it('rejects a truncated anon key', () => {
    expect(() => parseClientEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'short' })).toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });
});
