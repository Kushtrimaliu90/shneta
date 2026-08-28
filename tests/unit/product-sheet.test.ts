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

  it('marks the identifier columns as Text, which is what stops Excel reinterpreting a SKU', async () => {
    /*
     * Asserted on the column format, not on the round trip.
     *
     * A round-trip assertion here cannot fail: ExcelJS writes the string `MAR-3` and reads back the string
     * `MAR-3` whatever the format is. The mangling happens in **Excel the application**, on open, when the
     * column is General — which no unit test can observe. `numFmt: '@'` is the thing that prevents it, so
     * `numFmt: '@'` is the thing to assert; remove `text: true` from a column and this test goes red.
     */
    const buffer = await buildProductWorkbook([product], variants);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const check = (sheetName: string, columns: readonly { header: string; text?: boolean }[]) => {
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) throw new Error(`no ${sheetName} sheet`);
      const headers = sheet.getRow(1);
      for (const [offset, column] of columns.entries()) {
        expect(String(headers.getCell(offset + 1).value)).toBe(column.header);
        if (column.text) {
          expect(sheet.getColumn(offset + 1).style?.numFmt).toBe('@');
        }
      }
    };

    check('Products', PRODUCT_COLUMNS);
    check('Variants', VARIANT_COLUMNS);
    // And the SKU column specifically, since it is the one with a real-world casualty.
    const skuAt = VARIANT_COLUMNS.findIndex((column) => column.header === 'sku');
    expect(VARIANT_COLUMNS[skuAt]?.text).toBe(true);
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
    const buffer = await buildProductWorkbook([{ ...product, subtitleEn: '' }], variants);
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

/**
 * The files an operator actually produces, as opposed to the one the export writes.
 *
 * Every case here was reachable and silent before: a broken formula wrote the literal text `[object Object]`
 * into a product field, a duplicated heading let one column overwrite another, reordering the tabs produced
 * seventy identical "No id" complaints, and a renamed Variants tab discarded every price edit under a
 * cheerful "Saved."
 */
describe('a workbook a person has edited', () => {
  /** The Products sheet the reader will accept, as a bare minimum: a header row with `id`. */
  async function sheetWith(
    build: (workbook: ExcelJS.Workbook) => void,
  ): Promise<ReturnType<typeof readProductWorkbook>> {
    const workbook = new ExcelJS.Workbook();
    build(workbook);
    return readProductWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  }

  it('refuses a row whose formula produced an Excel error rather than writing "[object Object]"', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).getCell(1).value = 'abc';
      sheet.getRow(2).getCell(2).value = { formula: 'B99/0', result: { error: '#DIV/0!' } };
    });

    expect(read.ok).toBe(true);
    // Not the string "[object Object]", and not '' either — '' in a present column means "clear this field".
    expect(read.products.rows[0]?.name_sq).toBe('');
    expect(read.products.badCells).toHaveLength(1);
    expect(read.products.badCells[0]).toMatchObject({
      index: 0,
      column: 'name_sq',
      detail: '#DIV/0!',
    });
  });

  it('reads a formula that worked, since only the error case is unusable', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).getCell(1).value = 'abc';
      sheet.getRow(2).getCell(2).value = {
        formula: 'CONCATENATE("Vitamina"," D")',
        result: 'Vitamina D',
      };
    });

    expect(read.products.rows[0]?.name_sq).toBe('Vitamina D');
    expect(read.products.badCells).toHaveLength(0);
  });

  it('refuses two columns sharing a heading, and names them', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      // What somebody does when they want a working copy of a field.
      sheet.getRow(1).values = ['id', 'name_sq', 'name_sq'];
      sheet.getRow(2).values = ['abc', 'Original', 'Copy'];
    });

    expect(read.ok).toBe(false);
    expect(read.reason).toBe('duplicate_headers');
    expect(read.duplicates).toEqual(['name_sq']);
  });

  it('says the first sheet is not the Products sheet when the tabs are reordered', async () => {
    const read = await sheetWith((workbook) => {
      // Variants first, as a drag of the tab would leave it.
      const first = workbook.addWorksheet('Variants');
      first.getRow(1).values = ['product_slug', 'sku', 'price'];
      first.getRow(2).values = ['vitamin-d3-4000', 'NOW-D3-120', 9.9];
    });

    expect(read.ok).toBe(false);
    expect(read.reason).toBe('not_a_product_sheet');
  });

  it('reports a missing Variants sheet instead of silently ignoring every price', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).values = ['abc', 'Vitamina D'];
      // A tab renamed past both the name check and the /variant/ pattern.
      const other = workbook.addWorksheet('Cmimet');
      other.getRow(1).values = ['product_slug', 'sku', 'price'];
      other.getRow(2).values = ['vitamin-d3-4000', 'NOW-D3-120', 14.9];
    });

    expect(read.ok).toBe(true);
    expect(read.variantsMissing).toBe(true);
    expect(read.variants.rows).toHaveLength(0);
  });

  it('finds the Variants sheet through the pattern when only the name is off', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).values = ['abc', 'Vitamina D'];
      const other = workbook.addWorksheet('Variants (2)');
      other.getRow(1).values = ['product_slug', 'sku', 'price'];
      other.getRow(2).values = ['vitamin-d3-4000', 'NOW-D3-120', 14.9];
    });

    expect(read.variantsMissing).toBeFalsy();
    expect(read.variants.rows).toHaveLength(1);
  });

  it('reports the real worksheet row number, so a blank row does not shift every refusal', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).values = ['first', 'One'];
      // Row 3 left blank, as a delete-contents leaves it.
      sheet.getRow(4).values = ['second', 'Two'];
      sheet.getRow(5).values = ['third', 'Three'];
    });

    expect(read.products.rows.map((row) => row.id)).toEqual(['first', 'second', 'third']);
    // Not [2, 3, 4] — the third row is on line 5 of the operator's file.
    expect(read.products.rowNumbers).toEqual([2, 4, 5]);
  });

  it('keeps a row that is blank except for a broken cell, so it can be reported rather than skipped', async () => {
    const read = await sheetWith((workbook) => {
      const sheet = workbook.addWorksheet('Products');
      sheet.getRow(1).values = ['id', 'name_sq'];
      sheet.getRow(2).getCell(2).value = { formula: 'A1/0', result: { error: '#DIV/0!' } };
    });

    expect(read.products.rows).toHaveLength(1);
    expect(read.products.badCells).toHaveLength(1);
  });
});
