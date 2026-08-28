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
  /**
   * The real worksheet row number for each entry in `rows`.
   *
   * Not `index + 2`. Blank rows are skipped while reading, so a single stray blank in the middle of the file
   * shifts every row number after it — and a refusal that names row 41 when the operator's row 41 is fine is
   * worse than one that names no row at all.
   */
  rowNumbers: number[];
  /**
   * Cells that could not be reduced to text, keyed by index into `rows`.
   *
   * A formula whose result is an error (`#DIV/0!`, `#REF!`) is the case that matters. It cannot be treated as
   * empty — that would silently clear the field — and it cannot be stringified, because `String()` on
   * ExcelJS's error object yields the literal text `[object Object]`, which is then written to the shop.
   * So the reader records it and the importer refuses the row.
   */
  badCells: { index: number; column: string; detail: string }[];
}

export interface ProductWorkbookRead {
  ok: boolean;
  products: SheetRows;
  variants: SheetRows;
  reason?:
    | 'empty'
    | 'unreadable'
    | 'no_products_sheet'
    | 'no_rows'
    | 'too_many_rows'
    | 'duplicate_headers'
    | 'not_a_product_sheet';
  /** Repeated header names, when that is why the file was refused. */
  duplicates?: string[];
  /** True when no Variants sheet could be found, so every variant edit in the file was ignored. */
  variantsMissing?: boolean;
}

/**
 * Seventy products today. A file past this is not an edit of the catalogue.
 *
 * Exported so the message shown to the operator can state the real number. It previously said "more rows than
 * this catalogue has products", which is a different and much smaller number — an operator refused at 2,000
 * was told the limit was 70.
 */
export const MAX_ROWS = 2000;

const EMPTY: SheetRows = { headers: [], rows: [], rowNumbers: [], badCells: [] };

/** A cell that could not be reduced to text carries the reason instead. */
interface Cell {
  text: string;
  error?: string;
}

/**
 * A cell as the operator sees it.
 *
 * The order matters, and it is the same reasoning as `read.ts`: ExcelJS hands back rich text as an object,
 * a formula as `{ formula, result }`, a date as a `Date`, and a number as a number. A price cell is the one
 * that must not be got wrong — a number becomes `9.9`, never a localised `9,9`, because the file stores the
 * value and not its display.
 *
 * The one case with no sensible text is a formula whose result is an Excel error. Measured rather than
 * assumed: such a cell reads back as `{ formula: 'B99/0', result: { error: '#DIV/0!' } }`, and the previous
 * `String(value)` fallback turned it into the literal string `[object Object]` — which would then be written
 * into a product name on the live shop. Returning `''` would be no better: an empty cell in a present column
 * means *clear this field*. So it is reported as an error and the row is refused.
 */
function readCell(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'string') return { text: value.trim() };
  if (typeof value === 'number') return { text: String(value) };
  if (typeof value === 'boolean') return { text: value ? 'yes' : 'no' };
  if (value instanceof Date) {
    // Almost always Excel having mangled a SKU. Keep it recognisable rather than tidy.
    return { text: value.toISOString().slice(0, 10) };
  }
  if (typeof value === 'object') {
    // An error, whether bare or as a formula's result. Checked before `result`, which would recurse into it.
    if ('error' in value && typeof value.error === 'string') {
      return { text: '', error: value.error };
    }
    if ('result' in value && value.result !== undefined) {
      const result = value.result as ExcelJS.CellValue;
      if (
        result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
      ) {
        return { text: '', error: result.error };
      }
      return readCell(result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return {
        text: value.richText
          .map((part) => part.text)
          .join('')
          .trim(),
      };
    }
    if ('text' in value && typeof value.text === 'string') return { text: value.text.trim() };
    /*
     * An object shape not accounted for. `String()` on it produces `[object Object]`, so it is refused
     * rather than written — the whole class of bug this function exists to avoid.
     */
    return { text: '', error: 'unreadable cell' };
  }
  return { text: String(value).trim() };
}

/** Text only, for the header row, where an error cell is indistinguishable from a blank one anyway. */
function cellText(value: ExcelJS.CellValue): string {
  return readCell(value).text;
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
  const rowNumbers: number[] = [];
  const badCells: SheetRows['badCells'] = [];

  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1) return;

    const record: Record<string, string> = {};
    const bad: { column: string; detail: string }[] = [];
    let anything = false;

    headers.forEach((name, offset) => {
      if (name === null) return;
      const cell = readCell(row.getCell(offset + 1).value);
      record[name] = cell.text;
      if (cell.error) bad.push({ column: name, detail: cell.error });
      if (cell.text.length > 0) anything = true;
    });

    // A row of nothing is trailing formatting, not something somebody typed.
    if (!anything && bad.length === 0) return;

    // The real worksheet number, so a refusal names the row the operator is looking at.
    for (const entry of bad) badCells.push({ index: rows.length, ...entry });
    rows.push(record);
    rowNumbers.push(number);
  });

  return { headers: present, rows, rowNumbers, badCells };
}

/** Header names appearing more than once, which would make one column's data overwrite another's. */
function repeatedHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const name of headers) {
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }
  return [...twice];
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

    /*
     * Is the sheet we found actually the products sheet?
     *
     * The positional fallback takes worksheet 0, so reordering the tabs hands us the Variants sheet instead.
     * Every row then fails the `id` check and the operator gets seventy identical "No id" lines under a
     * heading saying nothing would change — which describes the file, not the mistake. `id` is the one column
     * the importer cannot work without, so its absence is the check.
     */
    if (!products.headers.includes('id')) return { ...blank, reason: 'not_a_product_sheet' };

    /*
     * Two columns with the same header.
     *
     * Rows are keyed by header name, so the rightmost duplicate silently wins and the other column's data is
     * discarded — or worse, lands in the field the operator meant to leave alone. Reachable by inserting a
     * column and naming it after an existing one, which is what somebody does when they want a working copy
     * of a field. There is no safe interpretation, so the file is refused and both names are reported.
     */
    const variantRows = readWorksheet(variantSheet);

    const repeated = [
      ...repeatedHeaders(products.headers),
      ...repeatedHeaders(variantRows.headers),
    ];
    if (repeated.length > 0) {
      return { ...blank, reason: 'duplicate_headers', duplicates: [...new Set(repeated)] };
    }

    if (products.rows.length === 0 && variantRows.rows.length === 0) {
      return { ...blank, reason: 'no_rows' };
    }
    if (products.rows.length > MAX_ROWS || variantRows.rows.length > MAX_ROWS) {
      return { ...blank, reason: 'too_many_rows' };
    }

    /*
     * A missing Variants sheet is reported, not refused.
     *
     * Deleting it to edit product fields only is legitimate. Renaming the tab so the name and the /variant/
     * pattern both miss is not, and previously produced the worst possible outcome: every price edit in the
     * file ignored, no warning, and a cheerful "Saved." The two cases are indistinguishable from here, so the
     * operator is told which sheets were read and can judge.
     */
    return {
      ok: true,
      products,
      variants: variantRows,
      variantsMissing: variantSheet === undefined,
    };
  } catch {
    /*
     * Deliberately not logged with the file contents — a catalogue is commercial data, and "this file
     * could not be read" is the whole of what the caller can act on.
     */
    return { ...blank, reason: 'unreadable' };
  }
}
