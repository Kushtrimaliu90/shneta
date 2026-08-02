import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  phoneSchema,
  passwordSchema,
  resetPasswordSchema,
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

  it('rejects anything that could leave the site', () => {
    for (const hostile of [
      'https://evil.example.com',
      'http://evil.example.com',
      // Protocol-relative: the browser treats this as a host, not a path.
      '//evil.example.com',
      '///evil.example.com',
      'javascript:alert(1)',
      'account/orders',
    ]) {
      expect(safeNextPath(hostile), hostile).toBe('/account');
    }
  });
});
