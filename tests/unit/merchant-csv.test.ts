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

  /**
   * The hundredfold bug, pinned in the direction that matters.
   *
   * This suite used to assert `parseOfferCsv('sku,price\nA,"1,250"') === 125_000` — a comma-delimited
   * sheet treating the comma as thousands. That reading is what turned an asking price of `9,90` into
   * **EUR 990.00** under a green "1 row applied", because the separator was chosen by the *field*
   * delimiter rather than by the number. Kosovo writes the decimal with a comma, so the rule was exactly
   * inverted for the market it serves.
   */
  it('reads a comma decimal even when the delimiter is also a comma', () => {
    expect(parseOfferCsv('sku,stok,cmimi\nA,12,"9,90"').rows[0]?.price_cents).toBe(990);
    expect(parseOfferCsv('sku,stok,cmimi\nA,12,"9,90"').malformed).toEqual([]);
  });

  it('refuses the genuinely ambiguous number instead of guessing', () => {
    // `1,250` is 1250 to one reader and 1.25 to another. Nothing in the cell says which.
    const result = parseOfferCsv('sku,price\nA,"1,250"');
    expect(result.rows).toEqual([]);
    expect(result.malformed).toEqual([{ line: 2, reason: 'ambiguous_price' }]);
  });

  it('reads both grouped forms, because the last separator is the decimal', () => {
    expect(parseOfferCsv('sku;price\nA;1.250,00').rows[0]?.price_cents).toBe(125_000);
    expect(parseOfferCsv('sku;price\nA;"1,250.00"').rows[0]?.price_cents).toBe(125_000);
  });

  it('treats repeated separators as grouping, and then refuses the result as a price', () => {
    /*
     * `1.250.000` cannot be a decimal — two separators — so it reads as 1250000. Which is then refused,
     * because a supplement does not cost 1.25 million euro. Both halves matter: the grouping rule is what
     * stops it becoming 1250.00, and the ceiling is what stops it reaching an int4 cast in the RPC.
     */
    expect(parseOfferCsv('sku;price\nA;1.250.000').malformed).toEqual([
      { line: 2, reason: 'bad_price' },
    ]);
    // A grouped number inside sane retail range still reads as grouping.
    expect(parseOfferCsv('sku;price\nA;12.500,50').rows[0]?.price_cents).toBe(1_250_050);
  });

  it('strips a currency symbol', () => {
    expect(parseOfferCsv('sku;price\nA;€ 9,90').rows[0]?.price_cents).toBe(990);
  });

  it('rounds to the nearest cent rather than truncating', () => {
    // Four decimals rather than three: three would be ambiguous with a thousands group.
    expect(parseOfferCsv('sku;price\nA;12,5551').rows[0]?.price_cents).toBe(1256);
  });

  it('refuses a price too large for the column instead of letting the RPC roll back the sheet', () => {
    // `::int` in merchant_bulk_upsert_offers used to raise `integer out of range`, discarding every
    // good row and surfacing as "something went wrong" with no line and no cell.
    expect(parseOfferCsv('sku;price\nA;12000000000').malformed).toEqual([
      { line: 2, reason: 'bad_price' },
    ]);
  });

  it('reports every problem on a row, not just the first', () => {
    // Was one reason per row with a `continue`, so a merchant fixed `bad_stock`, resubmitted, and met
    // `bad_price` — with the textarea cleared in between.
    const result = parseOfferCsv('sku;stok;cmimi\nA;abc;xyz');
    expect(result.malformed).toEqual([
      { line: 2, reason: 'bad_stock' },
      { line: 2, reason: 'bad_price' },
    ]);
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

/**
 * docs/16 §6.1 — the two columns bulk creation added.
 *
 * Both are bounded by column checks on `merchant_offers`, so the parser rejects them here with a line
 * number rather than letting Postgres answer with a constraint name.
 */
describe('handling days and the low-stock threshold', () => {
  it('reads both, in either language', () => {
    const english = parseOfferCsv('sku;price;handling;lowstock\nA-1;9,90;3;15');
    expect(english.rows).toEqual([
      { sku: 'A-1', price_cents: 990, handling_days: 3, low_stock_threshold: 15 },
    ]);

    const albanian = parseOfferCsv('sku;çmimi;dite;kufi\nA-1;9,90;3;15');
    expect(albanian.rows).toEqual([
      { sku: 'A-1', price_cents: 990, handling_days: 3, low_stock_threshold: 15 },
    ]);
  });

  it('accepts a sheet whose only settable column is one of them', () => {
    const result = parseOfferCsv('sku;handling\nA-1;2');
    expect(result.kind).toBe('ok');
    expect(result.rows).toEqual([{ sku: 'A-1', handling_days: 2 }]);
  });

  it('refuses a dispatch promise outside the column check', () => {
    expect(parseOfferCsv('sku;handling\nA-1;400').malformed).toEqual([
      { line: 2, reason: 'bad_handling' },
    ]);
    expect(parseOfferCsv('sku;handling\nA-1;-1').malformed).toEqual([
      { line: 2, reason: 'bad_handling' },
    ]);
    expect(parseOfferCsv('sku;handling\nA-1;soon').malformed).toEqual([
      { line: 2, reason: 'bad_handling' },
    ]);
  });

  it('refuses a negative low-stock level', () => {
    expect(parseOfferCsv('sku;lowstock\nA-1;-3').malformed).toEqual([
      { line: 2, reason: 'bad_threshold' },
    ]);
  });

  it('an empty cell means leave it alone, not zero', () => {
    const result = parseOfferCsv('sku;stok;handling;lowstock\nA-1;5;;');
    expect(result.rows).toEqual([{ sku: 'A-1', stock: 5 }]);
  });
});

/**
 * A barcode is a lookup key the database resolves, so it is accepted as the SKU column — and a sheet
 * carrying both must not have the answer depend on which one Excel put first.
 */
describe('the key column', () => {
  it('accepts a barcode header', () => {
    expect(parseOfferCsv('barkod;stok\n5012345678900;7').rows).toEqual([
      { sku: '5012345678900', stock: 7 },
    ]);
  });

  it('prefers sku over barcode wherever they sit', () => {
    const skuFirst = parseOfferCsv('sku;barcode;stok\nA-1;5012345678900;7');
    expect(skuFirst.rows).toEqual([{ sku: 'A-1', stock: 7 }]);

    const barcodeFirst = parseOfferCsv('barcode;sku;stok\n5012345678900;A-1;7');
    expect(barcodeFirst.rows, 'alias order decides, not column order').toEqual([
      { sku: 'A-1', stock: 7 },
    ]);
  });
});
