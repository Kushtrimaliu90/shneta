import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * docs/18 §3.6 — how a delivery is signed, and how a merchant verifies it.
 *
 *   X-BioCode-Signature: t=1760000000,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
 *
 * The timestamp is inside the signed string, so a captured delivery cannot be replayed a week later
 * against a receiver that checks the age. `v1` leaves room for a second scheme without breaking the
 * header. Pure, so the merchant-side `verifyWebhookSignature` can be lifted into their own code and
 * tested against the same vectors we test here.
 */

export const SIGNATURE_HEADER = 'X-BioCode-Signature';
export const EVENT_HEADER = 'X-BioCode-Event';
export const DELIVERY_HEADER = 'X-BioCode-Delivery';

export function signWebhookPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

/**
 * What a receiver does. `toleranceSeconds` bounds replay; five minutes is the usual choice.
 * Returns false rather than throwing for every malformed input — a verifier that throws on a
 * crafted header is a verifier that can be crashed.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null,
  options: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
    }),
  ) as Record<string, string>;

  const timestamp = Number(parts.t);
  const given = parts.v1;
  if (!Number.isInteger(timestamp) || !given || !/^[0-9a-f]{64}$/.test(given)) return false;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}
