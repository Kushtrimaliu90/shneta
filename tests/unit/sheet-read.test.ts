import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readSheet } from '@/lib/sheet/read';
import { parseOfferCsv } from '@/features/merchants/csv';

/**
 * Reading a real spreadsheet, tested against real spreadsheets.
 *
 * The fixtures are built with the same library that reads them, which would be circular if the assertions
 * were about the file format. They are not: they are about the **shapes Excel produces that used to break
 * the merchant** — a 13-digit barcode arriving as `8.71235E+12`, a comma decimal colliding with a comma
 * delimiter, a stray separator shifting a column. Those are properties of the cell values, and building
 * the fixture is the only way to state them.
 *
 * The final assertion is the one that matters: the text this produces goes through `parseOfferCsv` and
 * comes out as the numbers the merchant typed.
 */
async function xlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe('readSheet', () => {
  it('turns a spreadsheet into text the existing parser reads', async () => {
    const file = await xlsx([
      ['sku', 'stok', 'cmimi'],
      ['SKU-1', 12, 9.9],
    ]);
    const result = await readSheet(file, 'stok.xlsx');

    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(1);

    const parsed = parseOfferCsv(result.text);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.rows[0]).toEqual({ sku: 'SKU-1', stock: 12, price_cents: 990 });
  });

  it('quotes every cell, so a separator inside one cannot shift a column', async () => {
    // The exact corruption the offers export used to hand out: a merchant SKU containing the delimiter.
    const file = await xlsx([
      ['sku', 'merchant_sku', 'stok', 'cmimi'],
      ['SKU-1', 'ART;114', 7, 5.5],
    ]);
    const result = await readSheet(file, 'stok.xlsx');

    const parsed = parseOfferCsv(result.text);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.rows[0]).toEqual({ sku: 'SKU-1', stock: 7, price_cents: 550 });
  });

  it('keeps a 13-digit barcode as digits rather than scientific notation', async () => {
    const file = await xlsx([
      ['sku', 'stok'],
      [8712345678901, 3],
    ]);
    const result = await readSheet(file, 'stok.xlsx');

    expect(result.text).toContain('8712345678901');
    expect(result.text).not.toContain('E+');
    expect(parseOfferCsv(result.text).rows[0]?.sku).toBe('8712345678901');
  });

  it('reads a price cell without inventing a comma', async () => {
    // A number cell must reach the parser as `9.9`. Localising it here would feed `9,9` to a parser that
    // reads shapes, and a three-digit group would then be ambiguous.
    const file = await xlsx([
      ['sku', 'cmimi'],
      ['A', 1250],
    ]);
    const parsed = parseOfferCsv((await readSheet(file, 'p.xlsx')).text);
    expect(parsed.rows[0]?.price_cents).toBe(125_000);
    expect(parsed.malformed).toEqual([]);
  });

  it('ignores Excel trailing formatting rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['sku', 'stok']);
    sheet.addRow(['A', 1]);
    sheet.addRow([]);
    sheet.getCell('A9').value = null;
    const file = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const result = await readSheet(file, 'stok.xlsx');
    expect(result.rowCount).toBe(1);
  });

  it('refuses a sheet with a header and nothing under it', async () => {
    const result = await readSheet(await xlsx([['sku', 'stok']]), 'stok.xlsx');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_rows');
  });

  it('refuses an empty file and an unreadable one by name', async () => {
    expect((await readSheet(new ArrayBuffer(0), 'x.xlsx')).reason).toBe('empty');
    // A .xlsx that is not a zip at all — what arrives when somebody renames a .xls.
    const notAZip = new TextEncoder().encode('this is not a spreadsheet').buffer as ArrayBuffer;
    expect((await readSheet(notAZip, 'x.xlsx')).reason).toBe('unreadable');
  });

  it('passes a .csv straight through, keeping the parser as the single authority on delimiters', async () => {
    const csv = new TextEncoder().encode('sku;stok;cmimi\nA;4;7,50').buffer as ArrayBuffer;
    const result = await readSheet(csv, 'stok.csv');

    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(1);
    expect(parseOfferCsv(result.text).rows[0]).toEqual({ sku: 'A', stock: 4, price_cents: 750 });
  });
});
