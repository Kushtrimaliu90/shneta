import { describe, expect, it } from 'vitest';
import {
  API_SCOPES,
  SCOPE_FOR_ACTION,
  WEBHOOK_EVENTS,
  isApiScope,
} from '@/features/merchants/api/scopes';
import { scopesSchema } from '@/features/merchants/api/schemas';
import { generateWebhookSecret, WEBHOOK_SECRET_PREFIX } from '@/features/merchants/api-keys';

/**
 * docs/18 §2.1 — the scope vocabulary the app knows, which the SQL is the authority on.
 *
 * The integration suite asserts the two agree action by action; this file pins the shape the
 * portal and the schemas rely on, so a scope typo becomes a failed test rather than a checkbox
 * that saves a key the database then refuses.
 */

describe('API scopes', () => {
  it('are area:verb pairs over the six areas', () => {
    for (const scope of API_SCOPES) expect(scope).toMatch(/^[a-z]+:(read|write)$/);
    const areas = new Set(API_SCOPES.map((scope) => scope.split(':')[0]));
    expect([...areas].sort()).toEqual(['catalogue', 'offers', 'orders', 'proposals', 'webhooks']);
  });

  it('give every action exactly one scope, or none for `me`', () => {
    for (const [action, scope] of Object.entries(SCOPE_FOR_ACTION)) {
      if (action === 'me') expect(scope).toBeNull();
      else expect(scope && isApiScope(scope)).toBe(true);
    }
  });

  it('put every read under a :read scope and every write under :write', () => {
    const writes = Object.entries(SCOPE_FOR_ACTION).filter(([action]) =>
      /\.(upsert|create|attach_image|image_slot|accept|pack|ship|decline|update|delete|rotate|ping)$/.test(
        action,
      ),
    );
    expect(writes.length).toBeGreaterThan(10);
    for (const [, scope] of writes) expect(scope).toMatch(/:write$/);

    const reads = Object.entries(SCOPE_FOR_ACTION).filter(
      ([action, scope]) => scope && !writes.some(([write]) => write === action),
    );
    for (const [, scope] of reads) expect(scope).toMatch(/:read$/);
  });

  it('the schema refuses an unknown scope and an empty list', () => {
    expect(scopesSchema.safeParse(['offers:read']).success).toBe(true);
    expect(scopesSchema.safeParse(['offers:admin']).success).toBe(false);
    expect(scopesSchema.safeParse([]).success).toBe(false);
  });
});

describe('webhook events', () => {
  it('are dotted names with `ping` first', () => {
    expect(WEBHOOK_EVENTS[0]).toBe('ping');
    for (const event of WEBHOOK_EVENTS.slice(1)) expect(event).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('secrets carry the prefix and 43 base64url characters', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });
});
