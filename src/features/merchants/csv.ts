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
 * A price in euro to integer cents, decided by the **shape of the number** and never by the delimiter.
 *
 * ── What this replaces, and why it mattered ──
 *
 * The previous version keyed the decimal separator off the *field* separator: with `,` between fields a
 * comma could not be a decimal, so it was stripped as a thousands separator. Internally coherent, and
 * exactly backwards for a market where the comma **is** the decimal separator. Measured on the real
 * parser:
 *
 *   sku,stok,cmimi / SKU-1,12,"9,90"  →  99000 cents  →  EUR 990.00, reported as success
 *   sku,stok,cmimi / SKU-1,12,9,90    →    900 cents  →  EUR 9.00,   reported as success
 *
 * A hundred times too high under a green "1 row applied", on a path a Google Sheets export reaches
 * (comma-delimited, and an Albanian-locale sheet writes and quotes `"9,90"`). `merchant.bulk.pasteHint`
 * promised precisely this was safe, and a unit test pinned the 100x reading as correct.
 *
 * ── The rule ──
 *
 * Both separators present: the **last** one is the decimal, the other is grouping — `1.250,00` and
 * `1,250.00` are both 1250.00, which is what each locale means by them.
 *
 * One separator present: it is a decimal unless it is followed by exactly three digits, in which case
 * the two readings are `1250` and `1.25` and **there is no way to tell** — so it is refused by name
 * rather than guessed. That refusal is the whole point: a wrong guess here is a silent price change the
 * merchant cannot see, and the one thing worse than rejecting a row is applying the wrong money to it.
 *
 * Repeated separators are grouping — `1,250,000` cannot be a decimal.
 */
export type PriceParse =
  | { ok: true; cents: number }
  | { ok: false; reason: 'bad_price' | 'ambiguous_price' };

export function parsePriceEuro(raw: string): PriceParse {
  // Currency, spaces and the non-breaking space Excel pastes out of a formatted cell.
  const cleaned = raw.replace(/[€\s ]/g, '').replace(/^EUR/i, '');
  if (cleaned.length === 0) return { ok: false, reason: 'bad_price' };
  if (!/^-?[\d.,]+$/.test(cleaned)) return { ok: false, reason: 'bad_price' };

  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;

  let normalized: string;

  if (commas > 0 && dots > 0) {
    const decimal = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    normalized = cleaned.split(grouping).join('').replace(decimal, '.');
  } else if (commas + dots === 0) {
    normalized = cleaned;
  } else if (commas + dots > 1) {
    // Repeated: grouping. `1,250,000` has no decimal reading.
    normalized = cleaned.replace(/[.,]/g, '');
  } else {
    const separator = commas === 1 ? ',' : '.';
    const after = cleaned.slice(cleaned.indexOf(separator) + 1);
    if (/^\d{3}$/.test(after)) return { ok: false, reason: 'ambiguous_price' };
    normalized = cleaned.replace(separator, '.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: 'bad_price' };

  /*
   * Bounded here rather than at the int4 cast in `merchant_bulk_upsert_offers`. One fat-fingered
   * `12000000000` used to raise `integer out of range` inside the RPC, roll back all 199 good rows and
   * surface as "something went wrong" with no line and no cell — reproducing forever on every retry.
   * A price is refused on its own row instead, naming the row.
   */
  const cents = Math.round(value * 100);
  if (cents > 100_000_000) return { ok: false, reason: 'bad_price' };
  return { ok: true, cents };
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

    /*
     * More cells than the header has columns means a separator inside a cell, and every column after it
     * has shifted. Refused rather than read, because the shifted values are frequently still *valid* —
     * which is how it stayed invisible:
     *
     *   sku,stok,cmimi / A,12,9,90   →  the price column gets "9"  →  EUR 9.00 instead of EUR 9.90
     *
     * with an empty `malformed` list and a green "1 row applied". BioCode's own offer export reaches this
     * too: `merchant_sku` is free text up to 64 characters and is written unquoted, so a merchant whose
     * internal code contains the delimiter is handed a file we corrupted and gets the wrong stock back.
     *
     * Fewer cells is fine — a sheet whose trailing columns are empty is the ordinary case.
     */
    if (fields.length > headers.length) {
      malformed.push({ line: lineNumber, reason: 'too_many_columns' });
      continue;
    }

    const row: CsvRow = { sku };

    /*
     * Every problem on the row, not the first one.
     *
     * Each check used to `continue` on failure, so `A;abc;xyz` reported only `bad_stock`; the merchant
     * fixed it, resubmitted, and met `bad_price` — and the textarea had been cleared in between. Three
     * round trips for one row of typos. Collecting them means one repair pass.
     */
    const problems: string[] = [];

    if (stockColumn !== -1) {
      const raw = fields[stockColumn] ?? '';
      if (raw.trim().length > 0) {
        const stock = parseStock(raw);
        if (stock === null) problems.push('bad_stock');
        else if (stock < 0) problems.push('negative_stock');
        else row.stock = stock;
      }
    }

    if (priceColumn !== -1) {
      const raw = fields[priceColumn] ?? '';
      if (raw.trim().length > 0) {
        const parsed = parsePriceEuro(raw);
        if (!parsed.ok) problems.push(parsed.reason);
        else row.price_cents = parsed.cents;
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
        if (days === null || days < 0 || days > 30) problems.push('bad_handling');
        else row.handling_days = days;
      }
    }

    if (thresholdColumn !== -1) {
      const raw = fields[thresholdColumn] ?? '';
      if (raw.trim().length > 0) {
        const threshold = parseStock(raw);
        if (threshold === null || threshold < 0 || threshold > 100_000) problems.push('bad_threshold');
        else row.low_stock_threshold = threshold;
      }
    }

    if (problems.length > 0) {
      for (const reason of problems) malformed.push({ line: lineNumber, reason });
      continue;
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
