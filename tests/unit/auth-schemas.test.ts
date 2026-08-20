import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  phoneSchema,
  passwordSchema,
  resetPasswordSchema,
  magicLinkSchema,
  safeNextPath,
  signUpSchema,
  updateProfileSchema,
} from '@/features/auth/schemas';

describe('phoneSchema — Kosovo numbers (docs/05 §12.1)', () => {
  it('normalises every form customers actually type to E.164', () => {
    for (const input of [
      '+38344123456',
      '0038344123456',
      '044123456',
      '044 123 456',
      '044-123-456',
      '+383 44 123 456',
      '(044) 123456',
    ]) {
      expect(phoneSchema.parse(input), input).toBe('+38344123456');
    }
  });

  it('rejects numbers that are not dialable', () => {
    for (const input of [
      '',
      '12345',
      '04412345',
      '+3834412345678',
      'not a phone',
      '+49441234567',
    ]) {
      expect(phoneSchema.safeParse(input).success, input).toBe(false);
    }
  });

  it('rejects a leading zero after the country code', () => {
    // +383 0… is never valid; the local form's leading 0 is the trunk prefix.
    expect(phoneSchema.safeParse('+38304412345').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('trims and lowercases so lookups are stable', () => {
    expect(emailSchema.parse('  Klient@BIOCODE.com ')).toBe('klient@biocode.com');
  });

  it('rejects malformed addresses', () => {
    for (const input of ['', 'nope', 'a@b', 'a@@b.com']) {
      expect(emailSchema.safeParse(input).success, input).toBe(false);
    }
  });
});

describe('passwordSchema', () => {
  it('requires 8 characters and allows a long passphrase', () => {
    expect(passwordSchema.safeParse('short12').success).toBe(false);
    expect(passwordSchema.safeParse('correct-horse').success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
  });

  it('rejects beyond 72 characters — bcrypt silently truncates past that', () => {
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const valid = {
    fullName: 'Arta Krasniqi',
    email: 'arta@example.com',
    password: 'a-good-passphrase',
    terms: 'on',
  };

  it('accepts a complete registration', () => {
    const result = signUpSchema.safeParse(valid);
    expect(result.success).toBe(true);
    // Unchecked boxes are absent from FormData entirely, so the default must hold.
    expect(result.success && result.data.marketingOptIn).toBe(false);
  });

  it('requires the terms checkbox (docs/05 §15)', () => {
    const result = signUpSchema.safeParse({ ...valid, terms: undefined });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.flatten().fieldErrors.terms).toBeDefined();
  });

  it('reads a checked marketing box', () => {
    const result = signUpSchema.safeParse({ ...valid, marketingOptIn: 'true' });
    expect(result.success && result.data.marketingOptIn).toBe(true);
  });
});

describe('resetPasswordSchema', () => {
  it('reports the mismatch on the confirm field, where the user can see it', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'a-good-passphrase',
      confirmPassword: 'something-else',
    });
    expect(result.success).toBe(false);
    expect(
      result.success === false && result.error.flatten().fieldErrors.confirmPassword,
    ).toContain('PASSWORDS_DO_NOT_MATCH');
  });
});

describe('updateProfileSchema', () => {
  it('treats an empty phone as clearing the field, not as invalid', () => {
    const result = updateProfileSchema.safeParse({
      fullName: 'Arta Krasniqi',
      phone: '',
      preferredLocale: 'sq',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown locale', () => {
    const result = updateProfileSchema.safeParse({
      fullName: 'Arta Krasniqi',
      preferredLocale: 'de',
    });
    expect(result.success).toBe(false);
  });
});

/**
 * The open-redirect guard. An attacker who controls the post-login destination can bounce a
 * freshly authenticated customer to a look-alike domain, so this is security-relevant and
 * every rejection case is pinned.
 */
describe('safeNextPath', () => {
  it('allows same-site absolute paths', () => {
    expect(safeNextPath('/account/orders')).toBe('/account/orders');
    expect(safeNextPath('/checkout?step=2')).toBe('/checkout?step=2');
    expect(safeNextPath('/en/account')).toBe('/en/account');
  });

  it('falls back when there is nothing to honour', () => {
    expect(safeNextPath(null)).toBe('/account');
    expect(safeNextPath(undefined)).toBe('/account');
    expect(safeNextPath('')).toBe('/account');
    expect(safeNextPath('', '/')).toBe('/');
  });

  /*
   * The backslash case is the one that got through for months. `/\evil.example` starts with a single
   * slash and contains no `://`, so the original three checks passed it — and then every major browser
   * normalises the backslash to a forward slash, making `Location: /\evil.example` a protocol-relative
   * redirect off-site. Caught by a test written for the social sign-in helper, which assumed this was
   * already covered.
   */
  it('rejects anything that could leave the site', () => {
    for (const hostile of [
      'https://evil.example.com',
      'http://evil.example.com',
      // Protocol-relative: the browser treats this as a host, not a path.
      '//evil.example.com',
      '///evil.example.com',
      'javascript:alert(1)',
      'account/orders',
      // Backslash: normalised to '/' by every major browser, so this is protocol-relative too.
      '/\\evil.example',
      '/\\\\evil.example',
      // A tab or newline spliced in, which some browsers strip while parsing the URL.
      '/\tevil.example',
      '/account\nLocation: https://evil.example',
    ]) {
      expect(safeNextPath(hostile), hostile).toBe('/account');
    }
  });
});

/**
 * docs/05 §15.2 — the sign-in link.
 *
 * The schema is small on purpose, and what it *omits* is the point: no password, no `fullName`, and no
 * `terms`. Registering collects a name and an explicit acceptance; this only signs people in. The
 * guarantee that it cannot become a second registration path lives in `sendMagicLink`
 * (`shouldCreateUser: false`), and is asserted below so a future tidy-up cannot quietly drop it.
 */
describe('magicLinkSchema', () => {
  it('takes an email and an optional destination, nothing else', () => {
    const parsed = magicLinkSchema.parse({ email: 'a@b.com', next: '/account/orders' });
    expect(parsed).toEqual({ email: 'a@b.com', next: '/account/orders' });
    expect(magicLinkSchema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
  });

  it('rejects an address that is not one', () => {
    expect(magicLinkSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  /*
   * Left at its default, `signInWithOtp` creates an account for any unseen address — a registration
   * path that collects no name and never asks anyone to accept the terms, in a regulated category.
   * Asserted against the source because the alternative is a live Supabase project.
   */
  it('never creates an account, and never says whether one exists', () => {
    const source = readFileSync('src/features/auth/actions.ts', 'utf8');
    const action = source.slice(source.indexOf('export const sendMagicLink'));
    /*
     * `});` because the action is wrapped in `keepSubmitted` (docs/13 §AW). Asserted rather than
     * assumed: `indexOf` returns -1 when the terminator moves, and `slice(0, -1)` would quietly hand
     * the rest of the *file* to the checks below, which then pass or fail for unrelated reasons.
     */
    const end = action.indexOf('\n});');
    expect(end).toBeGreaterThan(0);
    const body = action.slice(0, end);

    expect(body).toContain('shouldCreateUser: false');
    expect(body).toContain("limitByIp('magicLink'");

    /*
     * The enumeration guarantee, stated precisely: whatever Supabase says about the address, the
     * branch that handles it only logs. `authFail` is fine *before* the call — the rate limit answers
     * the same way for everybody and leaks nothing — so the assertion is scoped to what happens after.
     */
    const afterSend = body.slice(body.indexOf('signInWithOtp'));
    expect(afterSend).toContain("logger.info('Magic link not sent'");
    expect(afterSend).toContain("return authOk('auth.magicLink.sent')");
    expect(afterSend).not.toContain('authFail(');
  });
});
