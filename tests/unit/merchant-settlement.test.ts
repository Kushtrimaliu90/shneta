import { describe, expect, it } from 'vitest';
import {
  merchantApplicationSchema,
  merchantSettlementSchema,
} from '@/features/merchants/schemas';

/**
 * Bank details are required for a transfer and not asked for at all for cash (docs/16 §8).
 *
 * The rule is cross-field, so it cannot live on either field's validator, and it is duplicated by a
 * check constraint in migration 71. Both layers matter and they guard different things: the constraint
 * makes the bad row impossible for *any* caller, and this makes the refusal land on the right input
 * with a message the applicant can act on instead of a Postgres constraint name.
 */

const VALID_IBAN = 'XK051000000000000000';

function application(overrides: Record<string, unknown> = {}) {
  return merchantApplicationSchema.safeParse({
    legalName: 'Bar Sh.p.k.',
    displayName: 'Bar Supplements',
    businessNo: '810123456',
    contactName: 'Arta Berisha',
    contactEmail: 'arta@example.com',
    contactPhone: '+38344123456',
    addressLine: 'Rruga B 12',
    city: 'Prishtinë',
    categories: 'Vitamins and minerals',
    acceptsTerms: 'on',
    acceptsCommission: 'on',
    settlementMethod: 'bank_transfer',
    bankName: 'BKT',
    iban: VALID_IBAN,
    ...overrides,
  });
}

/**
 * The field paths a failed parse complained about.
 *
 * Typed structurally rather than as `ReturnType<typeof application>` so the admin schema's results
 * work here too — the two schemas differ in shape but both report issues the same way, and asserting
 * on *which field* was rejected is the whole point.
 */
function badFields(result: {
  success: boolean;
  error?: { issues: readonly { path: readonly PropertyKey[] }[] };
}): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('merchant application — settlement', () => {
  it('accepts a bank transfer with full details', () => {
    expect(application().success).toBe(true);
  });

  it('accepts cash with no bank details at all', () => {
    // The whole point of the change: a merchant settling in cash has no account to give, and being
    // asked for one told them they were the wrong sort of applicant.
    const result = application({ settlementMethod: 'cash', bankName: undefined, iban: undefined });
    expect(result.success).toBe(true);
  });

  it('still refuses a bank transfer with no IBAN', () => {
    const result = application({ iban: undefined });
    expect(result.success).toBe(false);
    expect(badFields(result)).toContain('iban');
  });

  it('still refuses a bank transfer with no bank name', () => {
    const result = application({ bankName: undefined });
    expect(badFields(result)).toContain('bankName');
  });

  it('refuses a bank transfer whose IBAN is only whitespace', () => {
    // The same case the SQL check constraint spells out with `nullif(btrim(...), '')`: an empty
    // string is not a bank account, and a form post is perfectly capable of supplying one.
    expect(badFields(application({ iban: '   ' }))).toContain('iban');
  });

  it('defaults a missing settlement method to bank transfer rather than cash', () => {
    // A missing field must not be able to create a cash merchant by omission — an older client or a
    // hand-rolled post would otherwise opt itself out of the bank requirement.
    expect(application({ settlementMethod: undefined }).success).toBe(true);
    expect(badFields(application({ settlementMethod: undefined, iban: undefined }))).toContain(
      'iban',
    );
  });

  it('validates an IBAN that is supplied even when settling in cash', () => {
    // Optional is not the same as unchecked. A merchant who types one has told us something, and
    // storing it malformed helps nobody.
    const result = application({ settlementMethod: 'cash', iban: 'not-an-iban' });
    expect(badFields(result)).toContain('iban');
  });

  it('normalises spacing and case in the IBAN', () => {
    const result = application({ iban: 'xk05 1000 0000 0000 0000' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.iban).toBe(VALID_IBAN);
  });
});

/**
 * The admin's version of the same rule (docs/16 §8).
 *
 * It differs from the applicant's in one way that matters: the admin screen never receives a full
 * IBAN, only the last four digits, so a blank field means "leave it alone" rather than "there isn't
 * one". `hasIbanOnFile` is what lets the schema tell those apart — without it, an admin correcting a
 * bank name would be refused for not retyping an IBAN that is already stored.
 */
describe('admin settlement edit', () => {
  const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';

  function edit(overrides: Record<string, unknown> = {}) {
    return merchantSettlementSchema.safeParse({
      merchantId: MERCHANT_ID,
      settlementMethod: 'bank_transfer',
      bankName: 'BKT',
      iban: VALID_IBAN,
      ...overrides,
    });
  }

  it('accepts a full edit', () => {
    expect(edit().success).toBe(true);
  });

  it('accepts a blank IBAN when one is already on file', () => {
    // The bank-name correction. This is the case that would break if "blank" meant "missing".
    expect(edit({ iban: undefined, hasIbanOnFile: 'true' }).success).toBe(true);
  });

  it('refuses a blank IBAN when none is on file', () => {
    // Switching a cash merchant to bank transfer with nothing stored — the check constraint would
    // catch it, but the operator deserves the reason rather than a constraint name.
    const result = edit({ iban: undefined, hasIbanOnFile: undefined });
    expect(result.success).toBe(false);
    expect(badFields(result)).toContain('iban');
  });

  it('accepts switching to cash with nothing supplied', () => {
    expect(
      edit({ settlementMethod: 'cash', bankName: undefined, iban: undefined }).success,
    ).toBe(true);
  });

  it('still validates a malformed IBAN that is typed', () => {
    expect(badFields(edit({ iban: 'nope', hasIbanOnFile: 'true' }))).toContain('iban');
  });
});
