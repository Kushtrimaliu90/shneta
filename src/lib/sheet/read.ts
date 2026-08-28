import ExcelJS from 'exceljs';

/**
 * Turns an uploaded spreadsheet into the delimited text the existing parsers already understand.
 *
 * ── Why this exists ──
 *
 * Both bulk flows took a paste into a `<textarea>` and nothing else. A merchant who keeps stock in
 * `stok-tetor.xlsx` had to know to Save As CSV, know which delimiter their Excel locale writes, and know
 * that a comma decimal collides with a comma delimiter — three pieces of CSV knowledge before changing
 * one stock number. That is the whole of the owner's complaint (2026-08-10), and reading the cells
 * removes the failure modes rather than diagnosing them:
 *
 *   · no delimiter to detect, so `9,90` in a comma sheet cannot shift a column;
 *   · no BOM, no CRLF, no quoting rules;
 *   · a 13-digit barcode arrives as the number it is, not as `8.71235E+12`;
 *   · a SKU like `MAR-3` cannot have been turned into a date by the *file format* — though Excel may
 *     still have done it in the cell, which is why the template pre-formats those columns as text.
 *
 * ── Why on the server ──
 *
 * `scripts/check-bundle.ts` enforces First Load JS, which measures **client** bundles, so a parser used
 * only here costs nothing against it — the reason a hand-rolled OOXML reader was not worth owning. It
 * also has to be server-side anyway: a Server Action body is capped at 1 MB and a real spreadsheet is
 * not, so the file arrives at a route handler instead.
 *
 * ── The contract ──
 *
 * Out comes semicolon-delimited text with every cell quoted, which is the one shape the existing
 * parsers handle unambiguously. They keep their 39 and 25 unit cases, keep being pure and import-free,
 * and gain a second input format for free.
 *
 * ── No `server-only` here, deliberately ──
 *
 * The obvious guard would be `import 'server-only'`, and it makes the module untestable: Vitest resolves
 * that package to the client build and the suite fails to load, which is the same wall the search
 * redirects hit. This function takes an `ArrayBuffer` and returns a string — it has no session, no
 * client, and nothing to protect. What must not reach the browser is **ExcelJS**, and the backstop for
 * that is `scripts/check:bundle`, which fails the build if a heavy dependency lands in a client chunk.
 * Its only caller is a route handler, which is server by definition.
 */
export interface SheetReadResult {
  ok: boolean;
  /** Semicolon-delimited, every cell quoted. Empty when `ok` is false. */
  text: string;
  /** Rows excluding the header, for the "we read N rows" line. */
  rowCount: number;
  reason?: 'empty' | 'no_rows' | 'unreadable' | 'too_many_rows';
}

/** Beyond this a sheet is not a stock update, and the RPC caps apply anyway. */
const MAX_ROWS = 5000;

/**
 * A cell as the merchant sees it, not as the file stores it.
 *
 * The order matters. `ExcelJS` hands back rich text as an object, a formula as `{ formula, result }`, a
 * date as a `Date`, and a number as a number — and every one of those stringifies to something a parser
 * would reject or, worse, misread. A price cell is the dangerous one: `9.9` must become `9.9` and never
 * `9,9`, because the text this produces is fed to a parser that reads shapes.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) {
    // A date here is almost always Excel having mangled a SKU. Keep it recognisable rather than tidy.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined)
      return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join('')
        .trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
  }
  return String(value).trim();
}

const quote = (cell: string) => `"${cell.replace(/"/g, '""')}"`;

export async function readSheet(file: ArrayBuffer, filename: string): Promise<SheetReadResult> {
  const empty: SheetReadResult = { ok: false, text: '', rowCount: 0 };
  if (file.byteLength === 0) return { ...empty, reason: 'empty' };

  const isCsv = /\.csv$/i.test(filename);

  try {
    const workbook = new ExcelJS.Workbook();

    if (isCsv) {
      /*
       * A `.csv` goes straight through as text rather than through ExcelJS.
       *
       * ExcelJS's CSV reader would impose its own delimiter and date guessing on a file the existing
       * parser already handles better — including the header-alias table and the delimiter detection
       * that reads the header line only. Decoding and handing it over keeps one code path for
       * delimited text and one for real spreadsheets.
       */
      const text = new TextDecoder('utf-8').decode(file);
      const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (rows.length < 2) return { ...empty, reason: 'no_rows' };
      if (rows.length - 1 > MAX_ROWS) return { ...empty, reason: 'too_many_rows' };
      return { ok: true, text, rowCount: rows.length - 1 };
    }

    await workbook.xlsx.load(file);
    // The first worksheet, because a merchant's file has one sheet and naming it is a rule to remember.
    const sheet = workbook.worksheets[0];
    if (!sheet) return { ...empty, reason: 'no_rows' };

    const lines: string[] = [];
    let widest = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // `1`-based, and `row.cellCount` counts to the last non-empty cell on that row.
      for (let column = 1; column <= Math.max(row.cellCount, widest); column += 1) {
        cells.push(cellText(row.getCell(column).value));
      }
      widest = Math.max(widest, cells.length);
      // A row of nothing is Excel's trailing formatting, not data the merchant typed.
      if (cells.some((cell) => cell.length > 0)) lines.push(cells.map(quote).join(';'));
    });

    if (lines.length < 2) return { ...empty, reason: 'no_rows' };
    if (lines.length - 1 > MAX_ROWS) return { ...empty, reason: 'too_many_rows' };

    return { ok: true, text: lines.join('\n'), rowCount: lines.length - 1 };
  } catch {
    /*
     * Deliberately not logged with the file contents. A merchant's spreadsheet is commercial data, and
     * "this file could not be read" is the whole of what the caller can act on.
     */
    return { ...empty, reason: 'unreadable' };
  }
}
