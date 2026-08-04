import { describe, expect, it } from 'vitest';
import { filenameKeys, imageKey, parseProposalCsv } from '@/features/merchants/proposal-csv';

/**
 * docs/16 §9.1 — the pasted-catalogue parser and the filename matching.
 *
 * Every failure mode here costs a merchant an afternoon and leaves it concluding the feature is broken, and
 * none of them can be found by testing the happy path. The two that matter most:
 *
 *   · a sheet whose columns are read as **something else** — 200 prices written as 200 stock levels, silently;
 *   · a photograph that does not attach because of a hyphen, which is indistinguishable from a bug.
 */

describe('the header row', () => {
  it('reads a semicolon sheet with English headers', () => {
    const result = parseProposalCsv(
      'name;brand;form;variant;barcode;sku;stock;price\n' +
        'Magnesium Glycinate;Probe Labs;capsule;120 caps;5099999999901;MG-120;24;14,90',
    );

    expect(result.kind).toBe('ok');
    expect(result.rows).toEqual([
      {
        product_name: 'Magnesium Glycinate',
        brand_name: 'Probe Labs',
        form: 'capsule',
        variant_name: '120 caps',
        barcode: '5099999999901',
        merchant_sku: 'MG-120',
        stock_on_hand: 24,
        asking_price_cents: 1490,
      },
    ]);
  });

  it('reads the same sheet with Albanian headers', () => {
    const result = parseProposalCsv(
      'emri;marka;forma;varianti;barkod;kodi;stok;çmimi\n' +
        'Magnez Glicinat;Probe Labs;kapsula;120 kapsula;5099999999901;MG-120;24;14,90',
    );

    expect(result.rows[0]?.product_name).toBe('Magnez Glicinat');
    expect(result.rows[0]?.asking_price_cents).toBe(1490);
    expect(result.rows[0]?.barcode).toBe('5099999999901');
  });

  /**
   * Name, brand and price are structural. Without a price there is nothing to judge commercially, which is
   * most of what the reviewer is doing — and guessing which unnamed column holds it is how a sheet of prices
   * becomes a sheet of stock levels.
   */
  it('refuses a sheet with no price column', () => {
    const result = parseProposalCsv('name;brand;stock\nA;B;5');
    expect(result.kind).toBe('no_header');
    expect(result.rows).toHaveLength(0);
  });

  it('refuses a sheet with no brand column', () => {
    expect(parseProposalCsv('name;price\nA;5,00').kind).toBe('no_header');
  });

  it('refuses a headerless paste', () => {
    expect(parseProposalCsv('Magnesium;Probe Labs;14,90').kind).toBe('no_header');
  });

  it('survives a BOM, CRLF and a blank line', () => {
    const result = parseProposalCsv('﻿name;brand;price\r\nA;B;9,90\r\n\r\nC;D;8,50\r\n');
    expect(result.rows).toHaveLength(2);
  });

  it('honours a quoted field containing the delimiter', () => {
    const result = parseProposalCsv('name;brand;price\n"Omega 3; high EPA";Probe;19,90');
    expect(result.rows[0]?.product_name).toBe('Omega 3; high EPA');
  });
});

describe('the price column', () => {
  /** `;` between fields makes `14,90` unambiguous. With `,` between fields it cannot be. */
  it('reads a comma decimal when the delimiter is a semicolon', () => {
    expect(parseProposalCsv('name;brand;price\nA;B;14,90').rows[0]?.asking_price_cents).toBe(1490);
  });

  it('reads a comma as a thousands separator when the delimiter is a comma', () => {
    expect(parseProposalCsv('name,brand,price\nA,B,1250').rows[0]?.asking_price_cents).toBe(
      125_000,
    );
  });

  it('strips a euro sign', () => {
    expect(parseProposalCsv('name;brand;price\nA;B;€ 9,90').rows[0]?.asking_price_cents).toBe(990);
  });

  it('refuses a price that is not a number, with the line the merchant sees', () => {
    const result = parseProposalCsv('name;brand;price\nA;B;ask us');
    expect(result.malformed).toEqual([{ line: 2, reason: 'bad_price' }]);
  });

  it('refuses a zero or negative price', () => {
    expect(parseProposalCsv('name;brand;price\nA;B;0').malformed).toHaveLength(1);
    expect(parseProposalCsv('name;brand;price\nA;B;-4,00').malformed).toHaveLength(1);
  });
});

describe('the other columns', () => {
  it('defaults stock to zero rather than refusing the row', () => {
    expect(parseProposalCsv('name;brand;price\nA;B;9,90').rows[0]?.stock_on_hand).toBe(0);
  });

  it('refuses a non-numeric or negative stock', () => {
    expect(parseProposalCsv('name;brand;price;stock\nA;B;9,90;lots').malformed).toEqual([
      { line: 2, reason: 'bad_stock' },
    ]);
    expect(parseProposalCsv('name;brand;price;stock\nA;B;9,90;-2').malformed).toEqual([
      { line: 2, reason: 'negative_stock' },
    ]);
  });

  it('refuses a row with no name or no brand', () => {
    const result = parseProposalCsv('name;brand;price\n;B;9,90\nA;;9,90\nA;B;9,90');
    expect(result.malformed).toEqual([
      { line: 2, reason: 'incomplete' },
      { line: 3, reason: 'incomplete' },
    ]);
    expect(result.rows).toHaveLength(1);
  });

  /**
   * A source link is dropped rather than refused when it is not a URL.
   *
   * A merchant that typed "ask us" has still told us everything that matters about the product, and failing
   * the row over the one field a reviewer can live without would be the parser being fussier than the feature.
   */
  it('keeps a real link and quietly drops a non-link', () => {
    const good = parseProposalCsv('name;brand;price;link\nA;B;9,90;https://example.com/p/1');
    expect(good.rows[0]?.source_url).toBe('https://example.com/p/1');

    const bad = parseProposalCsv('name;brand;price;link\nA;B;9,90;ask us');
    expect(bad.rows).toHaveLength(1);
    expect(bad.rows[0]?.source_url).toBeUndefined();
  });

  it('trims fields to the limits the single-proposal form enforces', () => {
    const long = 'x'.repeat(300);
    const row = parseProposalCsv(`name;brand;price\n${long};${long};9,90`).rows[0];
    expect(row?.product_name).toHaveLength(160);
    expect(row?.brand_name).toHaveLength(120);
  });

  it('a good row after a bad one still lands', () => {
    const result = parseProposalCsv('name;brand;price\nA;B;nope\nC;D;7,50');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.product_name).toBe('C');
  });
});

/**
 * The filename is the key, because the alternative is three hundred dropdowns and nobody does that.
 *
 * The normalisation is deliberately brutal: the same code is written `5099-9999`, `5099 9999` and
 * `5099_9999` by three different people.
 */
describe('the image key', () => {
  it('strips everything that is not a letter or a digit', () => {
    expect(imageKey('5099-9999 9901')).toBe('509999999901');
    expect(imageKey('MG_120')).toBe('mg120');
  });

  it('refuses a key too short to identify anything', () => {
    expect(imageKey('AB')).toBeNull();
    expect(imageKey('')).toBeNull();
    expect(imageKey(undefined)).toBeNull();
  });
});

describe('keys from a filename', () => {
  it('reads the barcode out of a plain filename', () => {
    expect(filenameKeys('8712345678901.jpg')).toEqual(['8712345678901']);
  });

  it('drops a trailing counter, so the second photo of a product still matches', () => {
    expect(filenameKeys('8712345678901-2.jpg')).toEqual(['87123456789012', '8712345678901']);
    expect(filenameKeys('8712345678901_3.png')).toEqual(['87123456789013', '8712345678901']);
    expect(filenameKeys('MG-120 2.webp')).toEqual(['mg1202', 'mg120']);
  });

  /**
   * The whole stem is tried **first**, because a SKU may genuinely end in `-2`.
   *
   * Order is the assertion here: the caller matches in sequence, so a merchant whose code is `MG-2` gets its
   * own row rather than the row for `MG`.
   */
  it('tries the whole stem before the trimmed one', () => {
    expect(filenameKeys('MG-2.jpg')[0]).toBe('mg2');
  });

  /**
   * A counter is one to three digits, so a camera's four-digit sequence is left alone.
   *
   * `IMG_4821.JPG` yields one key, `img4821`, which matches no row and lands the file in the unmatched list
   * — the right outcome. Trimming four digits as well would turn every camera filename into the key `img`,
   * and a merchant whose SKU happened to be `IMG` would collect three hundred photographs of everything.
   */
  it('leaves a four-digit camera sequence intact', () => {
    expect(filenameKeys('IMG_4821.JPG')).toEqual(['img4821']);
    expect(filenameKeys('DSC_0007.jpg')).toEqual(['dsc0007']);
  });

  it('gives nothing when there is nothing but an extension', () => {
    expect(filenameKeys('.jpg')).toEqual([]);
  });
});
