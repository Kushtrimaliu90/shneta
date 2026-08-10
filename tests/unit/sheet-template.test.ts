import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplate } from '@/lib/sheet/template';
import { readSheet } from '@/lib/sheet/read';
import { parseOfferCsv } from '@/features/merchants/csv';
import { parseProposalCsv } from '@/features/merchants/proposal-csv';

/**
 * The template has to come back.
 *
 * A sample file the merchant cannot upload unchanged is worse than none: it teaches a shape and then
 * rejects it. The round trip is the whole assertion here — build the workbook, read it as if it had been
 * uploaded, and put the result through the parser that decides what gets written.
 *
 * The catalogue CSV failed exactly this before: it carried identifiers only, so pasting it back returned
 * `no_header` and told the merchant to add a header row while they were looking at one.
 */
async function roundTrip(kind: 'offers' | 'proposals', seed = [] as never[]) {
  const file = await buildTemplate(kind, seed);
  return readSheet(file, `template.xlsx`);
}

describe('the offers template', () => {
  const seed = [
    { sku: 'BIO-D3-1000', productName: 'Vitamina D3', stockOnHand: 12, priceCents: 990 },
    { sku: 'BIO-MG-120', productName: 'Magnez', stockOnHand: 4, priceCents: 1450 },
  ];

  it('round-trips: what we hand out is what the parser accepts', async () => {
    const file = await buildTemplate('offers', seed);
    const read = await readSheet(file, 'offers.xlsx');
    expect(read.ok).toBe(true);
    expect(read.rowCount).toBe(2);

    const parsed = parseOfferCsv(read.text);
    expect(parsed.kind).toBe('ok');
    expect(parsed.malformed).toEqual([]);
    // The merchant's own prices and stock, unchanged by the trip through Excel.
    expect(parsed.rows).toEqual([
      { sku: 'BIO-D3-1000', stock: 12, price_cents: 990 },
      { sku: 'BIO-MG-120', stock: 4, price_cents: 1450 },
    ]);
  });

  it('marks the SKU column as Text, so Excel cannot mangle a barcode', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate('offers', seed));
    const sheet = workbook.worksheets[0];
    // `@` is the Excel format code for Text. Without it a 13-digit code opens as 8.71235E+12.
    expect(sheet?.getColumn(1).style.numFmt).toBe('@');
  });

  it('freezes the header so a merchant scrolling 200 rows keeps the columns', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate('offers', seed));
    expect(workbook.worksheets[0]?.views?.[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('carries an instructions sheet, so the rules travel with the file', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate('offers', seed));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain('Udhezime');
  });

  it('falls back to an example row when the merchant has no offers yet', async () => {
    const read = await roundTrip('offers');
    expect(read.rowCount).toBe(1);
    expect(read.text).toContain('BIO-D3-1000');
  });
});

describe('the proposals template', () => {
  it('round-trips through the proposal parser', async () => {
    const read = await roundTrip('proposals');
    expect(read.ok).toBe(true);

    const parsed = parseProposalCsv(read.text);
    expect(parsed.kind).toBe('ok');
    expect(parsed.malformed).toEqual([]);
    expect(parsed.rows).toHaveLength(1);

    const row = parsed.rows[0];
    expect(row?.product_name).toBe('Magnesium Glycinate 120');
    expect(row?.brand_name).toBe('Alpha Labs');
    // 14,90 written in the example must survive as 1490 cents, not 149000.
    expect(row?.asking_price_cents).toBe(1490);
    expect(row?.stock_on_hand).toBe(24);
  });

  it('keeps a 13-digit barcode intact through the whole trip', async () => {
    const read = await roundTrip('proposals');
    expect(read.text).toContain('5099999999901');
    expect(read.text).not.toContain('E+');
    expect(parseProposalCsv(read.text).rows[0]?.barcode).toBe('5099999999901');
  });

  it('marks barcode and SKU as Text, which is where the mangling starts', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildTemplate('proposals'));
    const sheet = workbook.worksheets[0];
    expect(sheet?.getColumn(7).style.numFmt).toBe('@'); // barkod
    expect(sheet?.getColumn(8).style.numFmt).toBe('@'); // kodi
  });
});
