import { describe, expect, it } from 'vitest';
import { parseOfferCsv } from '@/features/merchants/csv';

/**
 * docs/16 §6 — parsing what a merchant actually pastes.
 *
 * Every case here is a shape a real spreadsheet produces, and none of them can be found by testing the
 * happy path. The expensive failures are the silent ones: a sheet whose columns are in an unexpected
 * order writing prices into stock levels, or `12,50` read as twelve and fifty.
 */

describe('the header', () => {
  it('reads a comma-delimited sheet with English headers', () => {
    const result = parseOfferCsv('sku,stock,price\nABC-1,5,12.50');
    expect(result.kind).toBe('ok');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 5, price_cents: 1250 }]);
  });

  /**
   * Excel in a comma-decimal locale — which Kosovo is — writes semicolons between fields. A parser that
   * only understood commas would fail for most merchants here.
   */
  it('reads a semicolon-delimited sheet, which is what Excel writes here', () => {
    const result = parseOfferCsv('sku;stock;price\nABC-1;5;12,50');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 5, price_cents: 1250 }]);
  });

  it('reads a tab-separated paste', () => {
    const result = parseOfferCsv('sku\tstock\tprice\nABC-1\t5\t12.50');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 5, price_cents: 1250 }]);
  });

  it('accepts Albanian headers', () => {
    const result = parseOfferCsv('kodi;stoku;çmimi\nABC-1;7;9,90');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 7, price_cents: 990 }]);
  });

  /** Excel writes a BOM, and it otherwise makes the first header unrecognisable. */
  it('survives a byte-order mark', () => {
    const result = parseOfferCsv('﻿sku,stock\nABC-1,5');
    expect(result.kind).toBe('ok');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 5 }]);
  });

  it('survives CRLF line endings and blank lines', () => {
    const result = parseOfferCsv('sku,stock\r\nABC-1,5\r\n\r\nABC-2,7\r\n');
    expect(result.rows).toHaveLength(2);
  });

  it('ignores columns it does not know', () => {
    const result = parseOfferCsv('sku,product,stock,notes\nABC-1,Vitamin D,5,whatever');
    expect(result.rows).toEqual([{ sku: 'ABC-1', stock: 5 }]);
  });

  /**
   * The refusal that matters. Guessing column order would write prices into stock levels for every row,
   * silently — so a sheet with no recognisable header is rejected outright.
   */
  it('refuses a sheet with no recognisable header', () => {
    const result = parseOfferCsv('ABC-1,5,12.50\nABC-2,7,9.90');
    expect(result.kind).toBe('no_header');
    expect(result.rows).toHaveLength(0);
  });

  it('refuses a sheet with a SKU column and nothing to change', () => {
    expect(parseOfferCsv('sku,product\nABC-1,Vitamin D').kind).toBe('no_header');
  });
});

describe('prices', () => {
  /**
   * With semicolons between fields, `12,50` is one field and means twelve fifty. With commas between
   * fields it cannot be, so a comma is a thousands separator — which is what `1,250` means there.
   */
  it('reads a comma decimal when the delimiter is a semicolon', () => {
    expect(parseOfferCsv('sku;price\nA;12,50').rows[0]?.price_cents).toBe(1250);
  });

  it('treats a comma as a thousands separator when the delimiter is a comma', () => {
    expect(parseOfferCsv('sku,price\nA,"1,250"').rows[0]?.price_cents).toBe(125_000);
  });

  it('strips a currency symbol', () => {
    expect(parseOfferCsv('sku;price\nA;€ 9,90').rows[0]?.price_cents).toBe(990);
  });

  it('rounds to the nearest cent rather than truncating', () => {
    expect(parseOfferCsv('sku;price\nA;12,555').rows[0]?.price_cents).toBe(1256);
  });

  it('reports a price that is not a number', () => {
    const result = parseOfferCsv('sku,price\nABC-1,twelve');
    expect(result.rows).toHaveLength(0);
    expect(result.malformed).toEqual([{ line: 2, reason: 'bad_price' }]);
  });

  it('reports a zero or negative price', () => {
    const result = parseOfferCsv('sku,price\nA,0\nB,-5');
    expect(result.rows).toHaveLength(0);
    expect(result.malformed.map((entry) => entry.reason)).toEqual(['bad_price', 'bad_price']);
  });
});

describe('stock', () => {
  /** Zero is meaningful and must survive: it is how a merchant says "sold out" in bulk. */
  it('accepts zero', () => {
    expect(parseOfferCsv('sku,stock\nA,0').rows).toEqual([{ sku: 'A', stock: 0 }]);
  });

  it('reports a negative quantity rather than applying it', () => {
    const result = parseOfferCsv('sku,stock\nA,-3');
    expect(result.rows).toHaveLength(0);
    expect(result.malformed).toEqual([{ line: 2, reason: 'negative_stock' }]);
  });

  it('reports a fractional quantity', () => {
    expect(parseOfferCsv('sku,stock\nA,2.5').malformed).toEqual([{ line: 2, reason: 'bad_stock' }]);
  });

  /** An empty cell means "leave it alone", which is not the same as zero. */
  it('an empty stock cell is omitted, not read as zero', () => {
    const result = parseOfferCsv('sku,stock,price\nA,,12.50');
    expect(result.rows).toEqual([{ sku: 'A', price_cents: 1250 }]);
  });
});

describe('rows it skips', () => {
  it('reports a row with no SKU', () => {
    const result = parseOfferCsv('sku,stock\n,5\nB,7');
    expect(result.rows).toEqual([{ sku: 'B', stock: 7 }]);
    expect(result.malformed).toEqual([{ line: 2, reason: 'no_sku' }]);
  });

  it('reports a row with nothing to change', () => {
    const result = parseOfferCsv('sku,stock,price\nA,,\nB,5,');
    expect(result.rows).toEqual([{ sku: 'B', stock: 5 }]);
    expect(result.malformed).toEqual([{ line: 2, reason: 'nothing_to_change' }]);
  });

  /** Line numbers include the header, so they match what the merchant sees in the spreadsheet. */
  it('numbers lines the way the merchant sees them', () => {
    const result = parseOfferCsv('sku,stock\nA,5\nB,nope\nC,7');
    expect(result.malformed).toEqual([{ line: 3, reason: 'bad_stock' }]);
    expect(result.rows).toHaveLength(2);
  });

  it('a good row after a bad one still applies', () => {
    const result = parseOfferCsv('sku,stock\nA,nope\nB,7');
    expect(result.rows).toEqual([{ sku: 'B', stock: 7 }]);
    expect(result.malformed).toHaveLength(1);
  });
});

describe('quoting', () => {
  it('honours a quoted field containing the delimiter', () => {
    const result = parseOfferCsv('sku,product,stock\n"ABC,1","Vitamin D, 60",5');
    expect(result.rows).toEqual([{ sku: 'ABC,1', stock: 5 }]);
  });

  it('reads a doubled quote as a literal one', () => {
    const result = parseOfferCsv('sku,stock\n"AB""C",5');
    expect(result.rows).toEqual([{ sku: 'AB"C', stock: 5 }]);
  });
});

describe('an empty paste', () => {
  it('is neither ok-with-rows nor a header error', () => {
    const result = parseOfferCsv('');
    expect(result.kind).toBe('ok');
    expect(result.rows).toHaveLength(0);
    expect(result.malformed).toHaveLength(0);
  });

  it('a header with no data rows parses to nothing', () => {
    const result = parseOfferCsv('sku,stock,price');
    expect(result.kind).toBe('ok');
    expect(result.rows).toHaveLength(0);
  });
});
