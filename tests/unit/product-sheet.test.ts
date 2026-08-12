import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
  buildProductWorkbook,
  type ProductExportRow,
  type VariantExportRow,
} from '@/lib/sheet/product-workbook';
import { readProductWorkbook } from '@/lib/sheet/product-read';

/**
 * The round trip, asserted end to end: build a workbook from rows, read it back, and check that what comes
 * out is what went in — plus the two properties the whole design rests on.
 *
 * These run against real ExcelJS output rather than a fixture file, so a change to how the workbook is
 * written is caught by the reader in the same test run.
 */

const product: ProductExportRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'vitamin-d3-4000',
  status: 'draft',
  brandSlug: 'now-foods',
  nameSq: 'Vitamina D3 4000 IU',
  nameEn: 'Vitamin D3 4000 IU',
  subtitleSq: '120 kapsula',
  subtitleEn: '120 capsules',
  descriptionSq: 'Pershkrim',
  descriptionEn: '',
  howToUseSq: 'Nje kapsule',
  howToUseEn: '',
  warningsSq: 'Kujdes',
  warningsEn: '',
  form: 'softgel',
  servingSize: '1 capsule',
  dietaryTags: 'vegan, gluten_free',
  categorySlugs: 'vitaminat, mineralet',
  primaryCategorySlug: 'vitaminat',
  goalSlugs: 'imuniteti',
  isFeatured: true,
  seoTitleSq: '',
  seoTitleEn: '',
  seoDescriptionSq: '',
  seoDescriptionEn: '',
  variantCount: 2,
  imageCount: 1,
};

const variants: VariantExportRow[] = [
  {
    productSlug: 'vitamin-d3-4000',
    sku: 'NOW-D3-120',
    nameSq: '120 kapsula',
    nameEn: '120 capsules',
    price: '9.90',
    compareAtPrice: '12.90',
    isActive: true,
    isDefault: true,
  },
  {
    productSlug: 'vitamin-d3-4000',
    // A SKU Excel would happily turn into a date if the column were not text-formatted.
    sku: 'MAR-3',
    nameSq: '60 kapsula',
    nameEn: '60 capsules',
    price: '5.50',
    compareAtPrice: '',
    isActive: false,
    isDefault: false,
  },
];

async function roundTrip(products: ProductExportRow[] = [product]) {
  const buffer = await buildProductWorkbook(products, variants);
  return readProductWorkbook(buffer);
}

describe('the product workbook round trip', () => {
  it('reads back every product field it wrote', async () => {
    const read = await roundTrip();
    expect(read.ok).toBe(true);

    const row = read.products.rows[0];
    expect(row?.id).toBe(product.id);
    expect(row?.slug).toBe('vitamin-d3-4000');
    expect(row?.name_sq).toBe('Vitamina D3 4000 IU');
    expect(row?.dietary_tags).toBe('vegan, gluten_free');
    expect(row?.categories).toBe('vitaminat, mineralet');
    expect(row?.primary_category).toBe('vitaminat');
    // Booleans travel as words, because a sheet full of TRUE reads like a formula result.
    expect(row?.is_featured).toBe('yes');
  });

  it('keeps a price recoverable as a dot decimal, whatever the display locale', async () => {
    /*
     * The price is written as a *number*, so the file stores 9.9 and the display locale is not part of the
     * data. This is the property that protects against the historical bug where a comma decimal in a
     * comma-delimited file produced a price a hundred times too high.
     */
    const read = await roundTrip();
    const first = read.variants.rows.find((row) => row.sku === 'NOW-D3-120');
    expect(first?.price).toBe('9.9');
    expect(first?.price).not.toContain(',');
  });

  it('does not let Excel reinterpret a SKU as a date', async () => {
    const read = await roundTrip();
    const skus = read.variants.rows.map((row) => row.sku);
    expect(skus).toContain('MAR-3');
    // A date would have come back as an ISO day.
    expect(skus.some((sku) => /^\d{4}-\d{2}-\d{2}$/.test(sku ?? ''))).toBe(false);
  });

  it('writes a blank compare-at price as an empty cell, not a zero', async () => {
    // Zero would mean "was free", which the storefront would render as a 100% discount.
    const read = await roundTrip();
    const second = read.variants.rows.find((row) => row.sku === 'MAR-3');
    expect(second?.compare_at_price).toBe('');
  });

  it('carries both data sheets', async () => {
    const read = await roundTrip();
    expect(read.products.rows).toHaveLength(1);
    expect(read.variants.rows).toHaveLength(2);
  });

  it('exposes every column as a header, so the importer can tell absent from empty', async () => {
    const read = await roundTrip();
    for (const column of PRODUCT_COLUMNS) {
      expect(read.products.headers).toContain(column.header);
    }
    for (const column of VARIANT_COLUMNS) {
      expect(read.variants.headers).toContain(column.header);
    }
  });
});

describe('absent columns versus empty cells', () => {
  /**
   * The rule the whole feature rests on: a column removed from the sheet must be distinguishable from a
   * column that is present with an empty cell. The first means "leave this alone", the second means "clear
   * it" — and if the reader collapsed them, one accidentally-deleted column would wipe a field across the
   * catalogue.
   */
  async function withoutColumn(header: string) {
    const buffer = await buildProductWorkbook([product], variants);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Products');
    if (!sheet) throw new Error('no Products sheet');

    /*
     * Located by its header cell, not by `column.key`.
     *
     * `key` is a write-time convenience and does not survive `xlsx.load` — looking for it returned -1 and
     * spliced column 0, which ExcelJS rejects. Row 1 is what actually persists, which is also what the
     * reader keys off, so this deletes the column the way an operator would.
     */
    const headerRow = sheet.getRow(1);
    let index = 0;
    for (let column = 1; column <= headerRow.cellCount; column += 1) {
      if (String(headerRow.getCell(column).value ?? '').toLowerCase() === header) {
        index = column;
        break;
      }
    }
    if (index === 0) throw new Error(`no such column: ${header}`);

    sheet.spliceColumns(index, 1);
    return readProductWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  it('drops a deleted column from the headers entirely', async () => {
    const read = await withoutColumn('description_en');
    expect(read.ok).toBe(true);
    expect(read.products.headers).not.toContain('description_en');
    // And the key is absent from the record, not present-and-empty.
    expect(read.products.rows[0] && 'description_en' in read.products.rows[0]).toBe(false);
  });

  it('keeps an emptied cell as a present key with an empty value', async () => {
    const buffer = await buildProductWorkbook(
      [{ ...product, subtitleEn: '' }],
      variants,
    );
    const read = await readProductWorkbook(buffer);
    expect(read.products.headers).toContain('subtitle_en');
    expect(read.products.rows[0]?.subtitle_en).toBe('');
  });

  it('leaves the other columns intact when one is deleted', async () => {
    const read = await withoutColumn('description_en');
    expect(read.products.rows[0]?.name_sq).toBe('Vitamina D3 4000 IU');
    expect(read.products.rows[0]?.description_sq).toBe('Pershkrim');
  });
});

describe('readProductWorkbook, on files it should refuse', () => {
  it('refuses an empty buffer', async () => {
    const read = await readProductWorkbook(new ArrayBuffer(0));
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('empty');
  });

  it('refuses something that is not a workbook', async () => {
    const read = await readProductWorkbook(new TextEncoder().encode('not a spreadsheet').buffer);
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('unreadable');
  });

  it('refuses a workbook with headers but no rows', async () => {
    const read = await readProductWorkbook(await buildProductWorkbook([], []));
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('no_rows');
  });

  it('finds the sheets by name even when the tabs have been renamed', async () => {
    /*
     * A localised Excel can rename a tab on save, and somebody may duplicate the file. Falling back to
     * position rather than refusing keeps a renamed tab from reading as an unreadable file.
     */
    const buffer = await buildProductWorkbook([product], variants);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Products');
    if (sheet) sheet.name = 'Produktet';
    const read = await readProductWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    expect(read.ok).toBe(true);
    expect(read.products.rows).toHaveLength(1);
  });
});
