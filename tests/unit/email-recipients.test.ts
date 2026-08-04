import { describe, expect, it } from 'vitest';
import { isUndeliverableRecipient } from '@/lib/email/recipients';

/**
 * The guard that stops the test suites bouncing mail off a brand-new sending domain.
 *
 * Worth testing properly rather than trusting a regex, because the failure is silent and
 * expensive in both directions: too loose and every E2E run hard-bounces dozens of messages at
 * `biocode.fit`'s reputation; too tight and a real customer stops receiving their order
 * confirmation with nothing in the log but a skip.
 */
describe('addresses that must never be sent to', () => {
  it.each([
    'e2e-customer-a1b2@biocode.test',
    'someone@anything.test',
    'someone@anything.invalid',
    'someone@anything.localhost',
    'someone@example.com',
    'someone@example.net',
    'someone@example.org',
  ])('blocks %s', (address) => {
    expect(isUndeliverableRecipient(address)).toBe(true);
  });

  it('blocks regardless of case and surrounding whitespace', () => {
    expect(isUndeliverableRecipient('  E2E-Customer@BIOCODE.TEST  ')).toBe(true);
  });

  it('blocks a display-name form, which is what EMAIL_FROM looks like', () => {
    expect(isUndeliverableRecipient('Test Person <someone@biocode.test>')).toBe(true);
  });

  it('blocks anything that is not an address at all', () => {
    // Reaching the provider with this can only produce an error; refusing is strictly better.
    expect(isUndeliverableRecipient('not-an-address')).toBe(true);
    expect(isUndeliverableRecipient('trailing@')).toBe(true);
  });
});

describe('addresses that must still be delivered', () => {
  it.each([
    ['kaliu@bkt.com.al', 'a real customer on a multi-part TLD'],
    ['porosite@biocode.fit', 'our own verified sending domain'],
    ['someone@gmail.com', 'the commonest recipient there is'],
    ['admin@biocode.dev', '.dev is a real TLD — the seeded staff accounts are reachable'],
    ['someone@testing.com', 'contains "test" but the TLD is com'],
    ['someone@example.co.uk', 'starts with example but is a real registrable domain'],
  ])('allows %s — %s', (address) => {
    expect(isUndeliverableRecipient(address)).toBe(false);
  });

  /**
   * The one that would be easy to get wrong.
   *
   * `.local` is mDNS, not an RFC 2606 reservation, and a corporate intranet can legitimately
   * deliver to it. Blocking it would be a guess dressed as a standard.
   */
  it('allows .local, which is mDNS rather than reserved-for-testing', () => {
    expect(isUndeliverableRecipient('someone@intranet.local')).toBe(false);
  });
});
