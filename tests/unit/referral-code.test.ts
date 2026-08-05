import { describe, expect, it } from 'vitest';
import {
  claimReferralCodeSchema,
  normalizeReferralCode,
  optionalReferralCodeSchema,
  referralCodeSchema,
} from '@/features/referrals/schemas';
import { signUpSchema } from '@/features/auth/schemas';

/**
 * docs/17 §1 — invite codes.
 *
 * The table below is deliberately the same table `public.normalize_referral_code()` was probed with.
 * Two implementations of one rule is a drift risk, and the mitigation is that both are checked
 * against identical inputs: if somebody widens the SQL and not this, the integration test that round
 * -trips a real code through the RPC fails, and if somebody widens this and not the SQL, a code the
 * form accepts is one the database rejects.
 */
const CASES: [input: string, expected: string | null][] = [
  ['BIO-K7F2M', 'BIO-K7F2M'],
  ['bio-k7f2m', 'BIO-K7F2M'],
  ['biok7f2m', 'BIO-K7F2M'],
  ['k7f2m', 'BIO-K7F2M'],
  [' BIO K7F2M ', 'BIO-K7F2M'],
  ['BIO_K7F2M', 'BIO-K7F2M'],
  // Too short, too long.
  ['BIO-K7F2', null],
  ['BIO-K7F2MM', null],
  // `O` and `1` are not in the alphabet, precisely so they cannot be confused with `0` and `I`.
  ['BIO-K7F2O', null],
  ['BIO-K7F21', null],
  ['', null],
  ['hello', null],
];

describe('normalizeReferralCode', () => {
  it.each(CASES)('%s → %s', (input, expected) => {
    expect(normalizeReferralCode(input)).toBe(expected);
  });

  it('accepts the whole share link, because that is what people paste', () => {
    for (const input of [
      'https://biocode.fit/r/BIO-K7F2M',
      'https://www.biocode.fit/en/r/bio-k7f2m',
      'biocode.fit/r/K7F2M',
      'Hey! Join me: https://biocode.fit/r/BIO-K7F2M and get started',
    ]) {
      expect(normalizeReferralCode(input), input).toBe('BIO-K7F2M');
    }
  });

  it('does not read a code out of an unrelated URL', () => {
    expect(normalizeReferralCode('https://biocode.fit/shop/vitamins')).toBeNull();
  });

  /*
   * The reason the bare five characters are safe to accept.
   *
   * An eight-character input starting with `BIO` can only be a prefixed code, because `I` and `O` are
   * not in the alphabet and so no code body can begin with `BIO`. If somebody ever adds them back,
   * this test is the one that says why they cannot.
   */
  it('cannot confuse a prefix with a code body', () => {
    expect(normalizeReferralCode('BIOXX')).toBeNull();
    expect('BIO'.split('').some((char) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.includes(char))).toBe(
      true,
    );
    expect(normalizeReferralCode('BIO-BIOXX')).toBeNull();
  });
});

describe('referralCodeSchema', () => {
  it('normalises on the way through', () => {
    expect(referralCodeSchema.parse('bio k7f2m')).toBe('BIO-K7F2M');
  });

  it('rejects a code that cannot be one, by key', () => {
    const result = referralCodeSchema.safeParse('nope');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('INVALID_REFERRAL_CODE');
  });

  it('refuses an empty required code', () => {
    expect(referralCodeSchema.safeParse('').success).toBe(false);
  });

  it('caps the length so a pasted essay is not carried around', () => {
    expect(referralCodeSchema.safeParse('x'.repeat(65)).success).toBe(false);
  });
});

describe('optionalReferralCodeSchema', () => {
  it('treats blank and absent as "nobody invited me", not as an error', () => {
    expect(optionalReferralCodeSchema.parse('')).toBeUndefined();
    expect(optionalReferralCodeSchema.parse(undefined)).toBeUndefined();
  });

  it('still rejects a code that is present and wrong', () => {
    // Otherwise a typo is silently dropped and the referrer is never credited, with nobody the wiser.
    expect(optionalReferralCodeSchema.safeParse('BIO-XX').success).toBe(false);
  });
});

describe('claimReferralCodeSchema — the account grace form', () => {
  it('normalises the field the action reads', () => {
    // The action feeds this straight to `claim_referral_code`, so what comes out here is what the
    // database is asked about.
    expect(claimReferralCodeSchema.parse({ code: ' bio-k7f2m ' })).toEqual({ code: 'BIO-K7F2M' });
  });

  it('requires a code — unlike the sign-up field, this form exists only to submit one', () => {
    expect(claimReferralCodeSchema.safeParse({ code: '' }).success).toBe(false);
    expect(claimReferralCodeSchema.safeParse({}).success).toBe(false);
  });
});

describe('signUpSchema with an invite code (docs/17 §1)', () => {
  const base = {
    fullName: 'Arta Berisha',
    email: 'Arta@Example.com',
    password: 'a-long-enough-password',
    terms: 'on',
  };

  it('registers without one', () => {
    const parsed = signUpSchema.parse(base);
    expect(parsed.referralCode).toBeUndefined();
  });

  it('normalises one that is given', () => {
    const parsed = signUpSchema.parse({ ...base, referralCode: 'bio k7f2m' });
    expect(parsed.referralCode).toBe('BIO-K7F2M');
  });

  it('reports a bad code against its own field, not as a generic failure', () => {
    const result = signUpSchema.safeParse({ ...base, referralCode: 'garbage' });
    expect(result.success).toBe(false);
    expect(Object.keys(result.error?.flatten().fieldErrors ?? {})).toEqual(['referralCode']);
  });

  it('an empty field does not block registration', () => {
    // The field is optional and is the last one on the form: it must never be the reason a customer
    // cannot create an account.
    expect(signUpSchema.safeParse({ ...base, referralCode: '' }).success).toBe(true);
  });
});
