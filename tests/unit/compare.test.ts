import { describe, expect, it } from 'vitest';
import { COMPARE_MAX, parseCompareIds, servingsFrom } from '@/features/compare/constants';

/**
 * docs/05 §9 — the two pure decisions behind the comparison table.
 *
 * Both read attacker-shaped input: `parseCompareIds` takes a query string anyone can hand-edit,
 * and `servingsFrom` takes free text an editor typed into the admin panel.
 */

describe('parseCompareIds', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const c = '33333333-3333-4333-8333-333333333333';
  const d = '44444444-4444-4444-8444-444444444444';
  const e = '55555555-5555-4555-8555-555555555555';

  it('reads a comma-separated list and keeps its order', () => {
    // Order is part of the contract: docs/05 §9 requires the link to reproduce the table,
    // which includes which product sits in which column.
    expect(parseCompareIds(`${b},${a}`)).toEqual([b, a]);
  });

  it('drops anything that is not an id rather than querying it', () => {
    expect(parseCompareIds(`${a},not-an-id,${b}`)).toEqual([a, b]);
    expect(parseCompareIds("'; drop table products; --")).toEqual([]);
  });

  it('de-duplicates, so the same product cannot fill two columns', () => {
    expect(parseCompareIds(`${a},${a},${b}`)).toEqual([a, b]);
  });

  it(`stops at ${COMPARE_MAX}`, () => {
    expect(parseCompareIds([a, b, c, d, e].join(','))).toHaveLength(COMPARE_MAX);
  });

  it('treats empty, null and whitespace as no selection', () => {
    expect(parseCompareIds('')).toEqual([]);
    expect(parseCompareIds(null)).toEqual([]);
    expect(parseCompareIds('  ,  ')).toEqual([]);
  });
});

describe('servingsFrom', () => {
  it('reads a pack count out of the label in both languages', () => {
    expect(servingsFrom('2 capsules daily, 60 per pack')).toBe(60);
    expect(servingsFrom('2 kapsula në ditë, 90 për paketë')).toBe(90);
    expect(servingsFrom('30 servings per pack')).toBe(30);
  });

  /*
   * The important half. Price per serving is the number a shopper uses to decide which of two
   * products is cheaper — one derived from a misparsed label is not a rough answer, it is a
   * wrong one, and the table renders "—" instead.
   */
  it('returns null rather than guessing when the label does not say', () => {
    expect(servingsFrom('2 capsules daily')).toBeNull();
    expect(servingsFrom('Take one scoop with water')).toBeNull();
    expect(servingsFrom('')).toBeNull();
    expect(servingsFrom(null)).toBeNull();
  });

  it('rejects a zero pack, which would divide by zero downstream', () => {
    expect(servingsFrom('0 per pack')).toBeNull();
  });
});
