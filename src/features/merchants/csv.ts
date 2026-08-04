/**
 * docs/16 §6 — parsing a merchant's pasted offer sheet.
 *
 * Since bulk **creation** (§6.1) the same sheet both updates existing offers and creates new ones, so it
 * carries two more optional columns — `handling_days` and `low_stock_threshold` — which a new offer needs
 * and an existing one keeps if the column is absent. There is deliberately no `condition` column:
 * `merchant_offers` has none, every supplement on the site is sold new, and an enum with one member is a
 * migration in exchange for nothing.
 *
 * Pure, no imports, so it can be unit-tested against the shapes real spreadsheets produce. That matters
 * more than it sounds: every failure mode here is a merchant losing an afternoon and concluding the
 * feature is broken, and none of them can be found by testing the happy path.
 *
 * ── What it deliberately handles ──
 *
 *   · **Semicolons.** Excel in a locale that uses a comma decimal separator writes `;` between fields.
 *     Kosovo is such a locale, so a comma-delimited-only parser would fail for most merchants.
 *   · **Comma decimals.** `12,50` is how the price is written here. With `;` delimiters that is
 *     unambiguous; with `,` delimiters it cannot be, so the delimiter decides how the number is read.
 *   · **A BOM**, which Excel writes and which otherwise makes the first header unrecognisable.
 *   · **CRLF**, quoted fields, and blank lines.
 *   · **Header aliases** in both languages, because the export the merchant edited may have been ours or
 *     its own.
 *
 * ── What it refuses ──
 *
 * A sheet with no recognisable header. Guessing column order is how a hundred prices become a hundred
 * stock levels, and the failure would be silent and expensive.
 */

export interface CsvRow {
  sku: string;
  /** Absent means "leave it alone" — a stock-only sheet is the common case. */
  stock?: number;
  price_cents?: number;
  /** Days before dispatch. The offer's own promise, which the scorecard measures against (§9). */
  handling_days?: number;
  /** When the portal starts warning the merchant it is running out. */
  low_stock_threshold?: number;
}

export interface CsvParseResult {
  kind: 'ok' | 'no_header';
  rows: CsvRow[];
  malformed: { line: number; reason: string }[];
}

/** Header names accepted for each column, lower-cased and stripped of punctuation. */
const HEADERS: Record<'sku' | 'stock' | 'price' | 'handling' | 'threshold', readonly string[]> = {
  sku: ['sku', 'kod', 'kodi', 'code', 'merchantsku', 'skuja', 'artikull', 'barkod', 'barcode'],
  stock: ['stock', 'stok', 'stoku', 'sasia', 'qty', 'quantity', 'stockonhand'],
  price: ['price', 'cmimi', 'çmimi', 'cmim', 'priceeur', 'pricecents', 'asking', 'kerkon'],
  /*
   * Both columns are new with bulk *creation*: a new offer needs a dispatch promise and a low-stock
   * warning level, and typing them into 200 forms one at a time is the thing this feature exists to
   * avoid. On an existing offer they behave like every other column — absent means "leave it alone".
   */
  handling: ['handling', 'handlingdays', 'dite', 'dit', 'ditepergatitje', 'pergatitje', 'dergesa'],
  threshold: ['lowstock', 'lowstockthreshold', 'threshold', 'kufi', 'kufistoku', 'minstock', 'min'],
};

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Splits one CSV line, honouring quoted fields.
 *
 * Hand-written rather than pulled in as a dependency: the grammar needed here is one page, and adding a
 * package to the bundle for a server-side textarea parse is a dependency to justify in docs/02 for no
 * gain.
 */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Which delimiter the sheet uses.
 *
 * Decided from the **header line only**, and by count. A data row full of `12,50` prices would make a
 * comma-delimited guess look right for the wrong reason; the header has no numbers in it.
 */
function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;

  if (tabs >= semicolons && tabs >= commas && tabs > 0) return '\t';
  return semicolons >= commas ? ';' : ',';
}

/**
 * A price in euro to integer cents.
 *
 * `delimiter` decides whether a comma can be a decimal separator: with `;` or a tab between fields,
 * `12,50` is one field and means twelve fifty. With `,` between fields it cannot be, so a comma is
 * treated as a thousands separator and stripped — which is what `1,250` means in that sheet.
 */
function parsePrice(raw: string, delimiter: string): number | null {
  const cleaned = raw.replace(/[€\s]/g, '');
  if (cleaned.length === 0) return null;

  const normalized = delimiter === ',' ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function parseStock(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  if (cleaned.length === 0) return null;
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseOfferCsv(text: string): CsvParseResult {
  // Excel writes a BOM, and it otherwise makes the first header unrecognisable.
  const withoutBom = text.replace(/^﻿/, '');
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { kind: 'ok', rows: [], malformed: [] };

  const headerLine = lines[0] ?? '';
  const delimiter = detectDelimiter(headerLine);
  const headers = splitLine(headerLine, delimiter).map(normalizeHeader);

  /*
   * Alias order decides, not column order.
   *
   * `sku` and `barcode` are both keys the database can resolve, so both are accepted for the same
   * column — and a sheet carrying both must not have the answer depend on which one Excel put first.
   * Searching the alias list in order makes `sku` win over `barkod` wherever they sit.
   */
  const columnOf = (kind: keyof typeof HEADERS): number => {
    for (const alias of HEADERS[kind]) {
      const index = headers.indexOf(alias);
      if (index !== -1) return index;
    }
    return -1;
  };

  const skuColumn = columnOf('sku');
  const stockColumn = columnOf('stock');
  const priceColumn = columnOf('price');
  const handlingColumn = columnOf('handling');
  const thresholdColumn = columnOf('threshold');

  /*
   * A recognisable SKU column and at least one thing to set. Refusing rather than guessing: a sheet
   * whose columns are in an unexpected order would otherwise write prices into stock levels, silently,
   * for every row.
   */
  if (
    skuColumn === -1 ||
    (stockColumn === -1 && priceColumn === -1 && handlingColumn === -1 && thresholdColumn === -1)
  ) {
    return { kind: 'no_header', rows: [], malformed: [] };
  }

  const rows: CsvRow[] = [];
  const malformed: { line: number; reason: string }[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const fields = splitLine(lines[index] ?? '', delimiter);
    const sku = (fields[skuColumn] ?? '').trim();

    // Line numbers are 1-based and include the header, so they match what the merchant sees.
    const lineNumber = index + 1;

    if (sku.length === 0) {
      malformed.push({ line: lineNumber, reason: 'no_sku' });
      continue;
    }

    const row: CsvRow = { sku };

    if (stockColumn !== -1) {
      const raw = fields[stockColumn] ?? '';
      if (raw.trim().length > 0) {
        const stock = parseStock(raw);
        if (stock === null) {
          malformed.push({ line: lineNumber, reason: 'bad_stock' });
          continue;
        }
        if (stock < 0) {
          malformed.push({ line: lineNumber, reason: 'negative_stock' });
          continue;
        }
        row.stock = stock;
      }
    }

    if (priceColumn !== -1) {
      const raw = fields[priceColumn] ?? '';
      if (raw.trim().length > 0) {
        const cents = parsePrice(raw, delimiter);
        if (cents === null) {
          malformed.push({ line: lineNumber, reason: 'bad_price' });
          continue;
        }
        row.price_cents = cents;
      }
    }

    /*
     * Two small integers, both bounded by the column checks on `merchant_offers`: a handling promise of
     * 400 days and a low-stock threshold of −5 are rejected here rather than at the constraint, so the
     * merchant gets a line number instead of a Postgres error.
     */
    if (handlingColumn !== -1) {
      const raw = fields[handlingColumn] ?? '';
      if (raw.trim().length > 0) {
        const days = parseStock(raw);
        if (days === null || days < 0 || days > 30) {
          malformed.push({ line: lineNumber, reason: 'bad_handling' });
          continue;
        }
        row.handling_days = days;
      }
    }

    if (thresholdColumn !== -1) {
      const raw = fields[thresholdColumn] ?? '';
      if (raw.trim().length > 0) {
        const threshold = parseStock(raw);
        if (threshold === null || threshold < 0 || threshold > 100_000) {
          malformed.push({ line: lineNumber, reason: 'bad_threshold' });
          continue;
        }
        row.low_stock_threshold = threshold;
      }
    }

    if (
      row.stock === undefined &&
      row.price_cents === undefined &&
      row.handling_days === undefined &&
      row.low_stock_threshold === undefined
    ) {
      malformed.push({ line: lineNumber, reason: 'nothing_to_change' });
      continue;
    }

    rows.push(row);
  }

  return { kind: 'ok', rows, malformed };
}
