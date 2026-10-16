import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  bearerFrom,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from '@/features/merchants/api-keys';

/**
 * docs/18 §1 — the key format, and the hash that is the contract with `merchant_api_exec`.
 *
 * The SQL recomputes `encode(sha256(convert_to(key, 'UTF8')), 'hex')`. If this file's `hashApiKey`
 * ever drifted from that — a different encoding, a salt, a different digest — every key would stop
 * working at once, and the symptom would be `unauthorized` with nothing in a log. So the hash is
 * pinned against a known vector here, not just checked for shape.
 */

describe('generateApiKey', () => {
  it('produces the documented shape', () => {
    const token = generateApiKey();
    expect(token.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(looksLikeApiKey(token)).toBe(true);
    // 32 bytes → 43 base64url characters, no padding.
    expect(token.length).toBe(API_KEY_PREFIX.length + 43);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiKey()));
    expect(seen.size).toBe(200);
  });
});

describe('hashApiKey', () => {
  it('is plain SHA-256 hex over the UTF-8 bytes, which is what the SQL computes', () => {
    const token = 'bck_live_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(hashApiKey(token)).toBe(expected);
    expect(hashApiKey(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and sensitive to a single character', () => {
    const a = generateApiKey();
    expect(hashApiKey(a)).toBe(hashApiKey(a));
    expect(hashApiKey(a)).not.toBe(hashApiKey(`${a.slice(0, -1)}x`));
  });
});

describe('apiKeyPrefix', () => {
  it('shows the prefix and four characters, never enough to use', () => {
    const token = `${API_KEY_PREFIX}abcdEFGH${'x'.repeat(35)}`;
    expect(apiKeyPrefix(token)).toBe('bck_live_abcd');
    expect(apiKeyPrefix(token).length).toBeLessThan(16);
  });
});

describe('looksLikeApiKey', () => {
  it('accepts a generated key', () => {
    expect(looksLikeApiKey(generateApiKey())).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['bck_live_', 'prefix only'],
    [`bck_test_${'a'.repeat(43)}`, 'wrong tier'],
    [`bck_live_${'a'.repeat(42)}`, 'too short'],
    [`bck_live_${'a'.repeat(44)}`, 'too long'],
    [`bck_live_${'a'.repeat(42)}+`, 'not base64url'],
    ['admin', 'a scanner'],
  ])('refuses %s (%s)', (value) => {
    expect(looksLikeApiKey(value)).toBe(false);
  });
});

describe('bearerFrom', () => {
  const token = generateApiKey();

  it('extracts a bearer token, case-insensitively on the scheme', () => {
    expect(bearerFrom(`Bearer ${token}`)).toBe(token);
    expect(bearerFrom(`bearer ${token}`)).toBe(token);
    expect(bearerFrom(`  Bearer   ${token}  `)).toBe(token);
  });

  it('returns null for anything that is not one of ours', () => {
    expect(bearerFrom(null)).toBeNull();
    expect(bearerFrom('')).toBeNull();
    expect(bearerFrom(token)).toBeNull();
    expect(bearerFrom(`Basic ${token}`)).toBeNull();
    expect(bearerFrom('Bearer not-a-key')).toBeNull();
    expect(bearerFrom(`Bearer ${token} extra`)).toBeNull();
  });
});
