import { describe, expect, it } from 'vitest';
import {
  offersUpsertBodySchema,
  proposalsCreateBodySchema,
} from '@/features/merchants/api/schemas';

/**
 * docs/18 §3 — the request bodies.
 *
 * The bounds mirror the CHECK constraints and the SQL caps, so a row the database would refuse is
 * refused here with a field path. The strictness is the part worth a test of its own: an integration
 * that sends `price_cent` must get a 400 naming the key, not a 200 that changed nothing.
 */

describe('offersUpsertBodySchema', () => {
  it('accepts a stock-only sync and defaults create to false', () => {
    const parsed = offersUpsertBodySchema.safeParse({ rows: [{ sku: 'ART-1', stock: 5 }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.create).toBe(false);
      expect(parsed.data.rows[0]).toEqual({ sku: 'ART-1', stock: 5 });
    }
  });

  it('keeps absent fields absent, so the SQL reads them as "leave it alone"', () => {
    const parsed = offersUpsertBodySchema.safeParse({ rows: [{ sku: 'ART-1', price_cents: 990 }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const first = parsed.data.rows[0] ?? {};
      expect('stock' in first).toBe(false);
      expect('handling_days' in first).toBe(false);
    }
  });

  it('refuses unknown properties rather than ignoring them', () => {
    const parsed = offersUpsertBodySchema.safeParse({ rows: [{ sku: 'ART-1', price_cent: 990 }] });
    expect(parsed.success).toBe(false);
  });

  const refused: Array<[Record<string, unknown>, string]> = [
    [{ sku: '', stock: 1 }, 'an empty SKU'],
    [{ sku: 'A', stock: -1 }, 'negative stock'],
    [{ sku: 'A', stock: 1.5 }, 'fractional stock'],
    [{ sku: 'A', price_cents: 0 }, 'a zero price'],
    [{ sku: 'A', price_cents: 9.9 }, 'a euro float'],
    [{ sku: 'A', price_cents: '990' }, 'a string price'],
    [{ sku: 'A', handling_days: 31 }, 'handling over 30'],
    [{ sku: 'A', low_stock_threshold: -1 }, 'a negative threshold'],
  ];

  it.each(refused)('refuses %j (%s)', (row) => {
    expect(offersUpsertBodySchema.safeParse({ rows: [row] }).success).toBe(false);
  });

  it('caps at 2000 rows and refuses an empty list', () => {
    const row = { sku: 'A', stock: 1 };
    expect(offersUpsertBodySchema.safeParse({ rows: [] }).success).toBe(false);
    expect(
      offersUpsertBodySchema.safeParse({ rows: Array.from({ length: 2000 }, () => row) }).success,
    ).toBe(true);
    expect(
      offersUpsertBodySchema.safeParse({ rows: Array.from({ length: 2001 }, () => row) }).success,
    ).toBe(false);
  });
});

describe('proposalsCreateBodySchema', () => {
  const row = { product_name: 'Magnesium', brand_name: 'NutriLab', asking_price_cents: 1250 };

  it('accepts the minimum and defaults stock to zero', () => {
    const parsed = proposalsCreateBodySchema.safeParse({ rows: [row] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.rows[0]?.stock_on_hand).toBe(0);
  });

  it('validates the optional URL and refuses unknown keys', () => {
    expect(
      proposalsCreateBodySchema.safeParse({ rows: [{ ...row, source_url: 'not a url' }] }).success,
    ).toBe(false);
    expect(
      proposalsCreateBodySchema.safeParse({ rows: [{ ...row, images: ['x.jpg'] }] }).success,
    ).toBe(false);
  });

  it('caps at 200 rows', () => {
    expect(
      proposalsCreateBodySchema.safeParse({ rows: Array.from({ length: 201 }, () => row) }).success,
    ).toBe(false);
  });
});
