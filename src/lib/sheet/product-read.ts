import ExcelJS from 'exceljs';

/**
 * Reading the product workbook back in.
 *
 * ── Why not `readSheet` ──
 *
 * `lib/sheet/read.ts` returns the **first** worksheet as semicolon-delimited text, which is exactly right
 * for the merchant flows: one sheet, and parsers that already understand delimited input. Neither holds
 * here. This file has two data sheets, and — more importantly — the whole safety rule depends on knowing
 * *which headers are present*, because a column that is absent must be left alone while a column that is
 * present but empty must be cleared. Delimited text cannot express "this column is not here"; it flattens
 * an absent column and an empty one into the same thing.
 *
 * So this returns header-keyed rows plus the header list itself, which is the shape the rule needs.
 *
 * ── What it does not do ──
 *
 * No validation, no coercion beyond turning a cell into the text a person sees. It does not know what a
 * price is or which columns matter. That belongs to the importer, which can name a row and a column when it
 * refuses something — and keeping this pure means it can be unit-tested against a real workbook without a
 * database.
 */

export interface SheetRows {
  /** Header names in file order, lower-cased and trimmed. Absence is meaningful. */
  headers: string[];
  /** One record per row, keyed by header. Missing headers are absent keys, not empty strings. */
  rows: Record<string, string>[];
}

export interface ProductWorkbookRead {
  ok: boolean;
  products: SheetRows;
  variants: SheetRows;
  reason?: 'empty' | 'unreadable' | 'no_products_sheet' | 'no_rows' | 'too_many_rows';
}

/** Seventy products today. A file past this is not an edit of the catalogue. */
const MAX_ROWS = 2000;

const EMPTY: SheetRows = { headers: [], rows: [] };

/**
 * A cell as the operator sees it.
 *
 * The order matters, and it is the same reasoning as `read.ts`: ExcelJS hands back rich text as an object,
 * a formula as `{ formula, result }`, a date as a `Date`, and a number as a number. A price cell is the one
 * that must not be got wrong — a number becomes `9.9`, never a localised `9,9`, because the file stores the
 * value and not its display.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) {
    // Almost always Excel having mangled a SKU. Keep it recognisable rather than tidy.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) {
      return cellText(value.result as ExcelJS.CellValue);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
  }
  return String(value).trim();
}

/**
 * One worksheet as headers plus records.
 *
 * A column whose header cell is empty is dropped entirely rather than given a positional name: an operator
 * who deletes a column leaves Excel's formatting behind, and inventing `column_7` for it would then look
 * like a field the importer failed to understand.
 */
function readWorksheet(sheet: ExcelJS.Worksheet | undefined): SheetRows {
  if (!sheet) return EMPTY;

  const headerRow = sheet.getRow(1);
  const headers: (string | null)[] = [];
  const width = Math.max(headerRow.cellCount, sheet.columnCount);

  for (let column = 1; column <= width; column += 1) {
    const name = cellText(headerRow.getCell(column).value).toLowerCase();
    headers.push(name.length > 0 ? name : null);
  }

  const present = headers.filter((name): name is string => name !== null);
  if (present.length === 0) return EMPTY;

  const rows: Record<string, string>[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, index) => {
    if (index === 1) return;

    const record: Record<string, string> = {};
    let anything = false;

    headers.forEach((name, offset) => {
      if (name === null) return;
      const text = cellText(row.getCell(offset + 1).value);
      record[name] = text;
      if (text.length > 0) anything = true;
    });

    // A row of nothing is trailing formatting, not something somebody typed.
    if (anything) rows.push(record);
  });

  return { headers: present, rows };
}

export async function readProductWorkbook(file: ArrayBuffer): Promise<ProductWorkbookRead> {
  const blank: ProductWorkbookRead = { ok: false, products: EMPTY, variants: EMPTY };
  if (file.byteLength === 0) return { ...blank, reason: 'empty' };

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);

    /*
     * Found by name, falling back to position.
     *
     * A localised Excel can rename a sheet on save, and somebody may reasonably duplicate the file and
     * rename the tab. The name is tried first because it is unambiguous when present; the first two
     * worksheets are the fallback because that is the order this file is written in. Looking only at
     * names would turn a renamed tab into "we could not read your file".
     */
    const byName = (wanted: string): ExcelJS.Worksheet | undefined =>
      workbook.worksheets.find((sheet) => sheet.name.trim().toLowerCase() === wanted);

    const productSheet = byName('products') ?? workbook.worksheets[0];
    const variantSheet =
      byName('variants') ??
      workbook.worksheets.find((sheet) => sheet !== productSheet && /variant/i.test(sheet.name));

    const products = readWorksheet(productSheet);
    if (products.headers.length === 0) return { ...blank, reason: 'no_products_sheet' };

    const variants = readWorksheet(variantSheet);

    if (products.rows.length === 0 && variants.rows.length === 0) {
      return { ...blank, reason: 'no_rows' };
    }
    if (products.rows.length > MAX_ROWS || variants.rows.length > MAX_ROWS) {
      return { ...blank, reason: 'too_many_rows' };
    }

    return { ok: true, products, variants };
  } catch {
    /*
     * Deliberately not logged with the file contents — a catalogue is commercial data, and "this file
     * could not be read" is the whole of what the caller can act on.
     */
    return { ...blank, reason: 'unreadable' };
  }
}
