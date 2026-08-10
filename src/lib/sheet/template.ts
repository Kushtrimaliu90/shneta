import ExcelJS from 'exceljs';

/**
 * The sample workbooks a merchant downloads, edits and sends straight back.
 *
 * ── Why a real `.xlsx` and not a CSV ──
 *
 * The offers page already offered a CSV, and a CSV is the source of most of the trouble it caused. It
 * cannot carry a column type, so Excel re-guesses every cell on open: a 13-digit barcode becomes
 * `8.71235E+12`, a SKU like `MAR-3` becomes `03-Mar`, and a price typed `9,90` collides with the comma
 * that separates the fields. Every one of those arrives later as "we do not list that product" or, until
 * migration 78, as a price a hundred times too high.
 *
 * A workbook fixes them **at source**. `numFmt: '@'` marks the identifier columns as Text, so Excel
 * leaves the barcode alone the moment the file opens — prevention rather than the diagnosis this
 * codebase had been accumulating.
 *
 * ── What makes it usable by someone in a hurry ──
 *
 *   · **Their own data is already in it** where we have it, so a stock update is typing over numbers
 *     rather than building a sheet. The blank template is for proposing products we do not list.
 *   · **One example row**, greyed and italic, showing the shape. Deleting it is obvious; guessing the
 *     format from a header is not.
 *   · **A frozen header** and real column widths, because a merchant scrolling 200 rows should not lose
 *     track of which column is the price.
 *   · **A second sheet of instructions** in their own language, so the rules travel with the file rather
 *     than living on a web page they closed.
 *
 * The header row uses the same names the parsers already accept, so the file round-trips: download,
 * edit, upload, and nothing has to be renamed in between.
 */

export type TemplateKind = 'offers' | 'proposals';

interface Column {
  header: string;
  width: number;
  /** Text-formatted so Excel cannot reinterpret it. Identifiers and nothing else. */
  text?: boolean;
  example: string | number;
  note: string;
}

/** Albanian, because this is the merchant-facing default and the reader is in a hurry. */
const OFFER_COLUMNS: Column[] = [
  { header: 'sku', width: 22, text: true, example: 'BIO-D3-1000', note: 'Kodi i produktit te BioCode. Mos e ndrysho.' },
  { header: 'produkti', width: 34, example: 'Vitamina D3 1000 IU', note: 'Vetem per orientim. Nuk lexohet.' },
  { header: 'stok', width: 10, example: 12, note: 'Sa njesi ke tani. 0 e fsheh oferten nga dyqani.' },
  { header: 'cmimi', width: 12, example: '9,90', note: 'Per nje njesi, ne euro. Shkruaje 9,90 ose 9.90.' },
  { header: 'dite', width: 10, example: 1, note: 'Dite deri sa e nis pakon. 0-30. Bosh = pa ndryshim.' },
  { header: 'kufi', width: 10, example: 3, note: 'Nen kete sasi te njoftojme. Bosh = pa ndryshim.' },
];

const PROPOSAL_COLUMNS: Column[] = [
  { header: 'emri', width: 34, example: 'Magnesium Glycinate 120', note: 'Emri i produktit. I detyrueshem.' },
  { header: 'marka', width: 22, example: 'Alpha Labs', note: 'Prodhuesi. I detyrueshem.' },
  { header: 'cmimi', width: 12, example: '14,90', note: 'Sa kerkon per nje njesi. I detyrueshem.' },
  { header: 'stok', width: 10, example: 24, note: 'Sa njesi ke tani.' },
  { header: 'forma', width: 16, example: 'kapsula', note: 'Kapsula, pluhur, pika...' },
  { header: 'varianti', width: 20, example: '120 kapsula', note: 'Madhesia ose permbajtja.' },
  { header: 'barkod', width: 18, text: true, example: '5099999999901', note: 'EAN ose UPC. Emri i fotografise duhet ta kete kete.' },
  { header: 'kodi', width: 18, text: true, example: 'MG-120', note: 'Kodi yt i magazines. Perdoret per fotografite nese s ka barkod.' },
  { header: 'linku', width: 34, example: 'https://', note: 'Faqja e prodhuesit, nese e ke.' },
];

const COLUMNS: Record<TemplateKind, Column[]> = {
  offers: OFFER_COLUMNS,
  proposals: PROPOSAL_COLUMNS,
};

const TITLE: Record<TemplateKind, string> = {
  offers: 'Ofertat',
  proposals: 'Propozimet',
};

/**
 * The instruction sheet, written for somebody who has never heard the word delimiter.
 *
 * Not a rules list — the three things that actually go wrong, and what to do instead.
 */
const HOW_TO: Record<TemplateKind, string[]> = {
  offers: [
    'Si te perdoret kjo flete',
    '',
    '1. Rreshti i pare permban emrat e kolonave. Mos e fshi dhe mos i riemerto.',
    '2. Rreshti me ngjyre gri eshte shembull. Fshije para se ta dergosh.',
    '3. Ndrysho vetem numrat qe do te ndryshosh. Kolona qe e le bosh nuk preket.',
    '4. Ruaje si Excel (.xlsx) dhe ngarkoje ne portal — nuk duhet ta kthesh ne CSV.',
    '',
    'Cmimi: shkruaje 9,90 ose 9.90. Mos shto ndares mijeshesh (1250,00 jo 1.250,00).',
    'Ndryshimi i cmimit e kthen oferten ne shqyrtim; stoku ndryshohet menjehere.',
    'Kolona sku duhet te mbetet e njejte — ajo e gjen oferten tende.',
  ],
  proposals: [
    'Si te perdoret kjo flete',
    '',
    '1. Rreshti i pare permban emrat e kolonave. Mos e fshi dhe mos i riemerto.',
    '2. Rreshti me ngjyre gri eshte shembull. Fshije para se ta dergosh.',
    '3. Emri, marka dhe cmimi jane te detyrueshme. Te tjerat ndihmojne shqyrtuesin.',
    '4. Ruaje si Excel (.xlsx) dhe ngarkoje ne portal — nuk duhet ta kthesh ne CSV.',
    '',
    'Fotografite: emerto skedaret sipas barkodit ose kodit tend, p.sh. 5099999999901.jpg',
    'dhe 5099999999901-2.jpg per foton e dyte. Ato lidhen vete me rreshtin perkates.',
    '',
    'Pasi ta miratojme, faqen e produktit e krijon BioCode dhe oferta jote krijohet vete.',
  ],
};

/**
 * Rows of the merchant's own data, so an offers sheet arrives already filled in.
 *
 * Stock and price go in as **numbers**, not strings: a number cell is what makes Excel show it
 * right-aligned and let the merchant type over it, and the reader turns it back into `9.9` rather than a
 * localised `9,9` that the price parser would then have to disambiguate.
 */
export interface OfferSeedRow {
  sku: string;
  productName: string;
  stockOnHand: number;
  priceCents: number;
}

export async function buildTemplate(
  kind: TemplateKind,
  seed: OfferSeedRow[] = [],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BIOCODE';
  const sheet = workbook.addWorksheet(TITLE[kind]);
  const columns = COLUMNS[kind];

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width,
    style: column.text ? { numFmt: '@' } : undefined,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2EE' } };
  // So the header stays put while the merchant scrolls two hundred rows.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  /*
   * The merchant's own offers, when we have them. Filling the sheet is the difference between "update
   * your stock" and "build a spreadsheet"; the second is a job, and jobs get postponed.
   */
  if (kind === 'offers' && seed.length > 0) {
    for (const row of seed) {
      sheet.addRow({
        sku: row.sku,
        produkti: row.productName,
        stok: row.stockOnHand,
        cmimi: row.priceCents / 100,
        dite: '',
        kufi: '',
      });
    }
  } else {
    const example = sheet.addRow(
      Object.fromEntries(columns.map((column) => [column.header, column.example])),
    );
    example.font = { italic: true, color: { argb: 'FF8A8F8B' } };
  }

  // What each column is, where the merchant is already looking.
  const notes = workbook.addWorksheet('Udhezime');
  notes.columns = [{ width: 100 }];
  for (const line of HOW_TO[kind]) notes.addRow([line]);
  notes.getRow(1).font = { bold: true, size: 13 };
  notes.addRow([]);
  notes.addRow(['Kolonat']).font = { bold: true, size: 13 };
  for (const column of columns) notes.addRow([`${column.header} — ${column.note}`]);

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
