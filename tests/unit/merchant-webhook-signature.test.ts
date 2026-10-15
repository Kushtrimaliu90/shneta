import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/features/merchants/webhooks/signature';

/**
 * docs/18 §3.6 — the signature a merchant verifies.
 *
 * `verifyWebhookSignature` is the function we tell merchants to copy, so it is tested as a receiver
 * would use it: against a header we produced, against a tampered body, against an old timestamp, and
 * against every malformed header a crafted request might carry.
 */

const SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BODY = '{"id":"d1","event":"ping","data":{}}';
const NOW = 1_760_000_000;

describe('signWebhookPayload', () => {
  it('is t=<ts>,v1=<hmac-sha256 over ts.body>', () => {
    const header = signWebhookPayload(SECRET, BODY, NOW);
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex');
    expect(header).toBe(`t=${NOW},v1=${expected}`);
  });
});

describe('verifyWebhookSignature', () => {
  const header = signWebhookPayload(SECRET, BODY, NOW);

  it('accepts what we signed, inside the tolerance', () => {
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: NOW + 10 })).toBe(true);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: NOW + 299 })).toBe(true);
  });

  it('refuses a changed body, a wrong secret and a stale timestamp', () => {
    expect(verifyWebhookSignature(SECRET, `${BODY} `, header, { now: NOW })).toBe(false);
    expect(verifyWebhookSignature(`${SECRET.slice(0, -1)}x`, BODY, header, { now: NOW })).toBe(
      false,
    );
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: NOW + 301 })).toBe(false);
    expect(verifyWebhookSignature(SECRET, BODY, header, { now: NOW - 301 })).toBe(false);
  });

  it.each([
    null,
    '',
    'v1=abc',
    `t=${NOW}`,
    `t=${NOW},v1=notahex`,
    `t=notanumber,v1=${'a'.repeat(64)}`,
    `t=${NOW},v1=${'a'.repeat(63)}`,
    `t=${NOW},v2=${'a'.repeat(64)}`,
  ])('refuses the malformed header %j without throwing', (value) => {
    expect(verifyWebhookSignature(SECRET, BODY, value, { now: NOW })).toBe(false);
  });

  it('honours a custom tolerance', () => {
    expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: NOW + 20, toleranceSeconds: 10 }),
    ).toBe(false);
  });
});
