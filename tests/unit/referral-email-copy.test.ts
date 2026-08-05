import { describe, expect, it } from 'vitest';
import { COPY } from '@/features/referrals/email-copy';
import { LOCALES } from '@/lib/constants';

/**
 * docs/17 §0.2, §7 — the privacy rule, asserted against the copy itself.
 *
 * Every other guard in this feature stops *data* about a referred customer reaching a referrer: the
 * missing RLS policy, the RPC that returns a month instead of a date, the ledger row with no `order_id`.
 * None of them stops a **sentence**. "Arta just spent €40!" is a disclosure written by a well-meaning
 * person filling in a template, and no schema prevents it.
 *
 * So the sentences are the thing under test. This is deliberately mechanical — it reads the copy table
 * and looks for the words and placeholders that could only be there to describe somebody else's
 * shopping. The seven templates that exist today pass; the point is the eighth.
 */

const KINDS = [
  'monthly',
  'expiry',
  'joined',
  'approved',
  'revoked',
  'welcome',
] as const;

type CopyTable = (typeof COPY)['en'];

function entries(locale: 'sq' | 'en'): [string, string][] {
  return Object.entries(COPY[locale] as Record<string, string>);
}

describe('the copy table is complete', () => {
  it('covers both locales with the same keys', () => {
    // A missing Albanian string falls back to English silently, which is how a customer in Prishtinë
    // receives an English email nobody meant to send.
    expect(Object.keys(COPY.sq).sort()).toEqual(Object.keys(COPY.en).sort());
  });

  it('has a subject, a heading and a lead for every template', () => {
    for (const locale of LOCALES) {
      for (const kind of KINDS) {
        const table = COPY[locale] as Record<string, string>;
        expect(table[`${kind}Subject`], `${locale}.${kind}Subject`).toBeTruthy();
        expect(table[`${kind}Heading`], `${locale}.${kind}Heading`).toBeTruthy();
        expect(table[`${kind}Intro`], `${locale}.${kind}Intro`).toBeTruthy();
      }
    }
  });

  it('leaves no string empty or whitespace', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of entries(locale)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });
});

describe('no template can describe a referred customer’s spending (docs/17 §0.2)', () => {
  /*
   * Placeholders, not prose, because a placeholder is what a future edit would reach for. There is no
   * `{amount}`, `{spend}`, `{order}` or `{date}` in this feature's data flow — the sweep row does not
   * carry them — so one appearing here means somebody plumbed a new field through to say something the
   * design forbids.
   */
  const FORBIDDEN_PLACEHOLDERS = /\{(amount|spend|spent|total|order|orderNumber|price|revenue|cents|email|phone|address)\}/i;

  it('uses no placeholder that would carry an amount, an order or contact details', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of entries(locale)) {
        expect(value, `${locale}.${key}`).not.toMatch(FORBIDDEN_PLACEHOLDERS);
      }
    }
  });

  /**
   * The placeholders that *are* allowed, listed exhaustively.
   *
   * An allowlist rather than a denylist for the thing that matters most: a denylist only catches the
   * words somebody thought of, and this catches anything new. `{points}` and `{value}` are the
   * **referrer's own** totals, which are theirs to see; `{name}` is always the masked "Arta B."
   */
  it('uses only the placeholders this feature actually has data for', () => {
    const ALLOWED = new Set(['period', 'points', 'value', 'days', 'date', 'name']);

    for (const locale of LOCALES) {
      for (const [key, value] of entries(locale)) {
        for (const match of value.matchAll(/\{(\w+)\}/g)) {
          expect(ALLOWED, `${locale}.${key} uses {${match[1]}}`).toContain(match[1]);
        }
      }
    }
  });

  /**
   * `{date}` is allowed in exactly one place, and this pins it there.
   *
   * It is the *expiry* date of the referrer's own link — a fact about their clock. In any other template
   * a date is the date a referred customer did something, which is precisely the timing signal monthly
   * posting exists to hide.
   */
  it('permits a date only in the expiry notice', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of entries(locale)) {
        if (value.includes('{date}')) {
          expect(key, `${locale}.${key}`).toMatch(/^expiry/);
        }
      }
    }
  });

  /**
   * And the referee's name appears only where a name is genuinely the message.
   *
   * `{name}` is the masked label either way, so this is a smaller point than the others — but the
   * monthly summary and the expiry notices are *aggregate* messages, and attaching a person to an
   * aggregate is how a total becomes attributable to one referral.
   */
  it('names a person only in the per-referral templates', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of entries(locale)) {
        if (value.includes('{name}')) {
          expect(key, `${locale}.${key}`).toMatch(/^(joined|approved|welcome)/);
        }
      }
    }
  });
});

describe('the revocation email keeps the admin’s reason out of it', () => {
  /*
   * `admin_revoke_referral` requires a reason and stores it, and the audit row is where it belongs: it is
   * an internal note, written in English, by somebody who did not expect a customer to read it. The
   * template has no slot for it, and that absence is the assertion.
   */
  it('has no placeholder for it', () => {
    for (const locale of LOCALES) {
      const table = COPY[locale] as Record<string, string>;
      for (const key of ['revokedSubject', 'revokedHeading', 'revokedIntro', 'revokedTail']) {
        expect(table[key] ?? '', `${locale}.${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  /** And it says the thing a person actually wants to know (docs/17 §1). */
  it('says the points already earned are not taken away', () => {
    expect(COPY.en.revokedTail).toMatch(/stay yours/i);
    expect(COPY.sq.revokedTail).toMatch(/mbeten/i);
  });
});

describe('the referee’s welcome explains what is shared about them (docs/17 §6)', () => {
  /*
   * The terms page says it too, but an email somebody actually opens is where it lands. The requirement
   * is §0.2's fourth mitigation: a referred customer should know the shape of what is shared about them.
   */
  it('states what the referrer can and cannot see', () => {
    expect(COPY.en.welcomeTail).toMatch(/first name and a surname initial/i);
    expect(COPY.en.welcomeTail).toMatch(/not what you buy/i);
    expect(COPY.sq.welcomeTail).toMatch(/emrin tuaj të parë/i);
    expect(COPY.sq.welcomeTail).toMatch(/as çka blini/i);
  });

  it('reassures them that nothing about their own prices changes', () => {
    expect(COPY.en.welcomeIntro).toMatch(/Nothing changes for you/i);
    expect(COPY.sq.welcomeIntro).toMatch(/nuk ndryshon asgjë/i);
  });
});

/** A guard against the copy table and the exported senders drifting apart. */
describe('every template kind is reachable', () => {
  it('has a matching key set for each kind', () => {
    const table = COPY.en as CopyTable as Record<string, string>;
    for (const kind of KINDS) {
      const keys = Object.keys(table).filter((key) => key.startsWith(kind));
      expect(keys.length, kind).toBeGreaterThanOrEqual(3);
    }
  });
});
