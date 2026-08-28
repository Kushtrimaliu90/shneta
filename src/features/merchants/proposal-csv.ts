/**
 * docs/16 §9.1 — parsing a merchant's pasted catalogue of products BioCode does not list.
 *
 * ── Why a second parser and not a flag on the first ──
 *
 * `csv.ts` reads an **offer** sheet: one key column and up to four numbers, where the key is a SKU or a
 * barcode interchangeably because the database resolves either. A proposal sheet has nine columns, and
 * `sku` and `barcode` are **different fields** on the same row — the merchant's own code, and the code on
 * the box. Folding both shapes into one parser would mean a flag deciding what a column means, which is the
 * bug this file exists to avoid: a sheet whose columns are read as something else, silently, for 200 rows.
 *
 * The delimiter, quoting, BOM and comma-decimal handling are deliberately duplicated in spirit but small
 * enough to restate; both files are pure so both can be unit-tested against what real spreadsheets produce.
 */
import { parsePriceEuro } from '@/features/merchants/csv';

export interface ProposalCsvRow {
  product_name: string;
  brand_name: string;
  asking_price_cents: number;
  stock_on_hand: number;
  form?: string;
  variant_name?: string;
  barcode?: string;
  merchant_sku?: string;
  source_url?: string;
  note?: string;
}

export interface ProposalCsvResult {
  kind: 'ok' | 'no_header';
  rows: ProposalCsvRow[];
  malformed: { line: number; reason: string }[];
}

/**
 * Accepted header names per column, lower-cased and stripped of punctuation.
 *
 * Both languages, because the sheet a merchant edits may be its own rather than one of ours — and a
 * merchant whose spreadsheet says `emri` should not have to learn our vocabulary to use the feature.
 */
const HEADERS = {
  name: ['name', 'productname', 'product', 'emri', 'emriproduktit', 'produkti', 'titulli'],
  brand: ['brand', 'brandname', 'marka', 'markaproduktit', 'prodhuesi', 'manufacturer'],
  price: ['price', 'asking', 'askingprice', 'cmimi', 'çmimi', 'cmim', 'priceeur', 'kerkon'],
  stock: ['stock', 'stok', 'stoku', 'sasia', 'qty', 'quantity', 'stockonhand'],
  form: ['form', 'forma', 'lloji', 'type'],
  variant: ['variant', 'variantname', 'varianti', 'size', 'madhesia', 'pesha', 'permbajtja'],
  barcode: ['barcode', 'barkod', 'barkodi', 'ean', 'upc', 'gtin'],
  sku: ['sku', 'kod', 'kodi', 'code', 'merchantsku', 'skuja', 'artikull'],
  source: ['source', 'sourceurl', 'link', 'linku', 'url', 'faqja'],
  note: ['note', 'shenim', 'shënim', 'shenime', 'arsyeja', 'comment', 'why'],
} as const;

type Column = keyof typeof HEADERS;

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Splits one CSV line, honouring quoted fields and a doubled quote as a literal one. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"') {
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

/** Decided from the header line only, and by count: a data row full of `12,50` would mislead. */
function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;

  if (tabs >= semicolons && tabs >= commas && tabs > 0) return '\t';
  return semicolons >= commas ? ';' : ',';
}

function parseWhole(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  if (cleaned.length === 0) return null;
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseProposalCsv(text: string): ProposalCsvResult {
  const withoutBom = text.replace(/^﻿/, '');
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { kind: 'ok', rows: [], malformed: [] };

  const headerLine = lines[0] ?? '';
  const delimiter = detectDelimiter(headerLine);
  const headers = splitLine(headerLine, delimiter).map(normalizeHeader);

  // Alias order decides, so a sheet with both `sku` and `kodi` resolves the same way whatever the order.
  const columnOf = (column: Column): number => {
    for (const alias of HEADERS[column]) {
      const index = headers.indexOf(alias);
      if (index !== -1) return index;
    }
    return -1;
  };

  const at: Record<Column, number> = {
    name: columnOf('name'),
    brand: columnOf('brand'),
    price: columnOf('price'),
    stock: columnOf('stock'),
    form: columnOf('form'),
    variant: columnOf('variant'),
    barcode: columnOf('barcode'),
    sku: columnOf('sku'),
    source: columnOf('source'),
    note: columnOf('note'),
  };

  /*
   * Name, brand and price are structural, not optional-with-a-default.
   *
   * A proposal is an argument for listing a product: without a name there is nothing to look up, without a
   * brand nothing to verify it against, and without an asking price nothing to judge commercially — which
   * is most of what the reviewer is doing. A sheet missing any of the three is not a proposal sheet, and
   * guessing which unnamed column holds the price is how 200 prices become 200 stock levels.
   */
  if (at.name === -1 || at.brand === -1 || at.price === -1) {
    return { kind: 'no_header', rows: [], malformed: [] };
  }

  const rows: ProposalCsvRow[] = [];
  const malformed: { line: number; reason: string }[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const fields = splitLine(lines[index] ?? '', delimiter);
    // Line numbers include the header, so they match what the merchant sees in the spreadsheet.
    const line = index + 1;

    const cell = (column: Column): string =>
      at[column] === -1 ? '' : (fields[at[column]] ?? '').trim();

    const name = cell('name');
    const brand = cell('brand');

    if (name.length === 0 || brand.length === 0) {
      malformed.push({ line, reason: 'incomplete' });
      continue;
    }

    /*
     * The shared parser, which reads the number by its shape rather than by the field separator. This
     * file had its own copy keyed off the delimiter, so a comma-delimited catalogue sheet turned an
     * asking price of "9,90" into EUR 990.00 — the same hundredfold error as the offers sheet, in the
     * flow that *creates* the offer on approval. One implementation now, so it cannot be fixed in one
     * place and left in the other.
     */
    const parsedPrice = parsePriceEuro(cell('price'));
    if (!parsedPrice.ok) {
      malformed.push({ line, reason: parsedPrice.reason });
      continue;
    }
    const price = parsedPrice.cents;

    let stock = 0;
    const rawStock = cell('stock');
    if (rawStock.length > 0) {
      const parsed = parseWhole(rawStock);
      if (parsed === null) {
        malformed.push({ line, reason: 'bad_stock' });
        continue;
      }
      if (parsed < 0) {
        malformed.push({ line, reason: 'negative_stock' });
        continue;
      }
      stock = parsed;
    }

    const row: ProposalCsvRow = {
      // Trimmed to the column limits the single-proposal form enforces, so both paths agree.
      product_name: name.slice(0, 160),
      brand_name: brand.slice(0, 120),
      asking_price_cents: price,
      stock_on_hand: stock,
    };

    const form = cell('form');
    if (form) row.form = form.slice(0, 80);
    const variant = cell('variant');
    if (variant) row.variant_name = variant.slice(0, 120);
    const barcode = cell('barcode');
    if (barcode) row.barcode = barcode.slice(0, 32);
    const sku = cell('sku');
    if (sku) row.merchant_sku = sku.slice(0, 64);
    const note = cell('note');
    if (note) row.note = note.slice(0, 2000);

    /*
     * A source link is accepted only when it is one.
     *
     * Dropped rather than refused: a merchant that pasted "ask us" into the link column has still told us
     * everything that matters about the product, and failing the row over the one field a reviewer can
     * live without would be the parser being fussier than the feature.
     */
    const source = cell('source');
    if (/^https?:\/\/\S+$/i.test(source)) row.source_url = source.slice(0, 500);

    rows.push(row);
  }

  return { kind: 'ok', rows, malformed };
}

/**
 * The key a photograph's filename has to carry to find its row: the barcode, else the merchant's own SKU.
 *
 * Normalised hard — lower-cased, stripped of everything that is not a letter or a digit — because the same
 * code is written `5099-9999`, `5099 9999` and `5099_9999` by three different people, and a merchant whose
 * photograph did not attach because of a hyphen will conclude the feature is broken.
 */
export function imageKey(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Two characters is not a key; it would match half the sheet.
  return key.length >= 3 ? key : null;
}

/**
 * The candidate keys in one filename, best first.
 *
 * `8712345678901-2.jpg` is the second photograph of one product, so the trailing counter comes off — but
 * the whole stem is tried first, because a merchant whose SKU genuinely ends in `-2` must not have it
 * truncated. Both are returned and the caller matches in order.
 */
export function filenameKeys(filename: string): string[] {
  const stem = filename.replace(/\.[a-z0-9]+$/i, '');
  const whole = imageKey(stem);
  const trimmed = imageKey(stem.replace(/[-_ ]+\d{1,3}$/, ''));

  const keys: string[] = [];
  if (whole) keys.push(whole);
  if (trimmed && trimmed !== whole) keys.push(trimmed);
  return keys;
}
