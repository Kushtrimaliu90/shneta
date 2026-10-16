import { describe, expect, it } from 'vitest';
import {
  fulfilmentDeclineBodySchema,
  fulfilmentShipBodySchema,
  fulfilmentsQuerySchema,
  webhookCreateBodySchema,
  webhookUpdateBodySchema,
} from '@/features/merchants/api/schemas';
import { imageExtensionFor } from '@/features/merchants/api/image-types';

/**
 * docs/18 §3.4–§3.6 — the request shapes added with fulfilments, photographs and webhooks.
 */

describe('fulfilment bodies', () => {
  it('ship needs a carrier and a tracking code', () => {
    expect(
      fulfilmentShipBodySchema.safeParse({ carrier: 'DHL', tracking_code: 'ABC123' }).success,
    ).toBe(true);
    expect(fulfilmentShipBodySchema.safeParse({ carrier: 'DHL' }).success).toBe(false);
    expect(
      fulfilmentShipBodySchema.safeParse({ carrier: 'D', tracking_code: 'ABC123' }).success,
    ).toBe(false);
  });

  it('decline needs a reason somebody can learn from', () => {
    expect(
      fulfilmentDeclineBodySchema.safeParse({ reason: 'Out of stock since Monday' }).success,
    ).toBe(true);
    expect(fulfilmentDeclineBodySchema.safeParse({ reason: 'no' }).success).toBe(false);
    expect(fulfilmentDeclineBodySchema.safeParse({}).success).toBe(false);
  });

  it('the list filter accepts a known status and nothing else', () => {
    expect(fulfilmentsQuerySchema.safeParse({}).success).toBe(true);
    expect(fulfilmentsQuerySchema.safeParse({ status: 'assigned' }).success).toBe(true);
    expect(fulfilmentsQuerySchema.safeParse({ status: 'unassigned' }).success).toBe(false);
    expect(fulfilmentsQuerySchema.safeParse({ status: 'assigned', page: '2' }).success).toBe(false);
  });
});

describe('webhook bodies', () => {
  const good = { url: 'https://erp.example/hooks/biocode', events: ['offer.approved'] };

  it('accepts an https endpoint with known events', () => {
    const parsed = webhookCreateBodySchema.safeParse({ ...good, description: 'ERP' });
    expect(parsed.success).toBe(true);
  });

  it('refuses http, an unknown event, an empty event list and unknown keys', () => {
    expect(
      webhookCreateBodySchema.safeParse({ ...good, url: 'http://erp.example/x' }).success,
    ).toBe(false);
    expect(webhookCreateBodySchema.safeParse({ ...good, events: ['order.paid'] }).success).toBe(
      false,
    );
    expect(webhookCreateBodySchema.safeParse({ ...good, events: [] }).success).toBe(false);
    expect(webhookCreateBodySchema.safeParse({ ...good, secret: 'mine' }).success).toBe(false);
  });

  it('an update must change something, and may only set a known status', () => {
    expect(webhookUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(webhookUpdateBodySchema.safeParse({ status: 'active' }).success).toBe(true);
    expect(webhookUpdateBodySchema.safeParse({ status: 'paused' }).success).toBe(false);
    expect(webhookUpdateBodySchema.safeParse({ events: ['ping', 'payout.paid'] }).success).toBe(
      true,
    );
  });
});

describe('imageExtensionFor', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['IMAGE/PNG; charset=binary', 'png'],
  ])('maps %s to %s', (type, ext) => {
    expect(imageExtensionFor(type)).toBe(ext);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/json', '', null])('refuses %j', (type) => {
    expect(imageExtensionFor(type)).toBeNull();
  });
});
