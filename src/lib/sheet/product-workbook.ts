import ExcelJS from 'exceljs';

/**
 * The catalogue as a workbook: download it, edit it, send it back.
 *
 * ── Why three sheets and not one ──
 *
 * A product has many variants, so a single flat sheet has to repeat the product's fields on each variant
 * row — and that creates an ambiguity with no good answer: edit the description on row 1 and leave row 2
 * alone, and the importer has to guess which of two conflicting values the operator meant. There is no
 * rule for that anybody would remember. Separate sheets remove the question instead of answering it.
 *
 * `Products` is keyed by `id`, `Variants` by product slug plus SKU, and the third sheet is the rules.
 *
 * ── The blank-cell rule, and why it keys off the header ──
 *
 * This is the one decision that decides whether the feature is safe.
 *
 * A round-trip export arrives with every cell already filled, so "a blank cell means no change" would make
 * it impossible to *clear* a field — you could add an English subtitle but never remove one. And "a blank
 * cell clears the field" means one accidentally-emptied column wipes that field across the catalogue.
 *
 * So neither cell-level rule works, and the resolution is one level up: **a column absent from the sheet is
 * not touched; a column present with an empty cell is cleared.** Delete the whole `description_en` column
 * and no description is harmed. Empty one cell in a column you kept, and you meant it. Both intentions are
 * expressible and neither is the default for the other.
 *
 * The schema makes this representable: every optional text column is `not null default '{}'`, so "cleared"
 * is a legal state. `name` is `not null` with no default, which is why an empty Albanian name is a refused
 * row rather than a cleared field.
 *
 * ── Prices are written as numbers ──
 *
 * Not strings. A number cell is stored numerically in the file, so a Kosovo Excel showing `9,90` and a UK
 * Excel showing `9.90` are the same underlying value and `readSheet` recovers `9.9` from both. Writing the
 * string `"9,90"` would have made the display locale part of the data. Identifier columns get the opposite
 * treatment — `numFmt: '@'` marks them Text so Excel cannot turn `MAR-3` into a date on open.
 */

/**
 * One product as cells.
 *
 * Declared here rather than in the feature that fills it, because `lib/` is a dependency leaf (docs/02 §4)
 * and may not import from `features/`. That is the right direction anyway: this module owns what a row of
 * the file *is*, and the query's job is to satisfy it.
 */
export interface ProductExportRow {
  id: string;
  slug: string;
  status: string;
  brandSlug: string;
  nameSq: string;
  nameEn: string;
  subtitleSq: string;
  subtitleEn: string;
  descriptionSq: string;
  descriptionEn: string;
  howToUseSq: string;
  howToUseEn: string;
  warningsSq: string;
  warningsEn: string;
  form: string;
  servingSize: string;
  dietaryTags: string;
  categorySlugs: string;
  primaryCategorySlug: string;
  goalSlugs: string;
  isFeatured: boolean;
  seoTitleSq: string;
  seoTitleEn: string;
  seoDescriptionSq: string;
  seoDescriptionEn: string;
  /** Read-only in the sheet — a count, so a row shows what it carries without opening the product. */
  variantCount: number;
  imageCount: number;
}

export interface VariantExportRow {
  productSlug: string;
  sku: string;
  nameSq: string;
  nameEn: string;
  /** A plain dot-decimal string; written to the file as a number. */
  price: string;
  compareAtPrice: string;
  isActive: boolean;
  isDefault: boolean;
}

interface Column {
  header: string;
  width: number;
  /** Text-formatted, so Excel leaves it alone. Identifiers only. */
  text?: boolean;
  /** Numeric cell. Prices, so no display locale can become part of the value. */
  number?: boolean;
  note: string;
}

/**
 * The product columns, in the order somebody would read them.
 *
 * `id` first and text-formatted. It is the only thing tying a row back to a product, which is what lets the
 * slug itself be edited — matching on slug would make renaming a URL indistinguishable from pointing the
 * row at a different product.
 */
export const PRODUCT_COLUMNS: Column[] = [
  { header: 'id', width: 38, text: true, note: 'Identifies the product. Never change or delete this column.' },
  { header: 'slug', width: 30, text: true, note: 'The web address. Editable while a draft; locked once published.' },
  { header: 'status', width: 14, note: 'draft, pending_review or archived. Cannot be set to published here — that needs compliance.' },
  { header: 'brand', width: 22, text: true, note: 'The brand slug. Must already exist.' },
  { header: 'name_sq', width: 34, note: 'Required. A row with this empty is refused, not cleared.' },
  { header: 'name_en', width: 34, note: 'Optional. Blank falls back to Albanian on the shop.' },
  { header: 'subtitle_sq', width: 30, note: 'The pack spec shown on the product card.' },
  { header: 'subtitle_en', width: 30, note: '' },
  { header: 'description_sq', width: 50, note: 'Markdown.' },
  { header: 'description_en', width: 50, note: '' },
  { header: 'how_to_use_sq', width: 34, note: '' },
  { header: 'how_to_use_en', width: 34, note: '' },
  { header: 'warnings_sq', width: 34, note: 'Required by law for melatonin, iron and anything contraindicated in pregnancy.' },
  { header: 'warnings_en', width: 34, note: '' },
  { header: 'form', width: 14, note: 'capsule, tablet, softgel, powder, liquid, gummy, bar, spray, sachet, other.' },
  { header: 'serving_size', width: 18, note: 'Free text, e.g. 2 capsules daily.' },
  { header: 'dietary_tags', width: 30, note: 'Comma separated: vegan, vegetarian, gluten_free, sugar_free, lactose_free, halal, non_gmo.' },
  { header: 'categories', width: 34, text: true, note: 'Comma separated category slugs. Replaces whatever is there now.' },
  { header: 'primary_category', width: 22, text: true, note: 'One of the above. Decides the breadcrumb; publishing needs it.' },
  { header: 'goals', width: 34, text: true, note: 'Comma separated health goal slugs.' },
  { header: 'is_featured', width: 12, note: 'yes or no.' },
  { header: 'seo_title_sq', width: 30, note: 'Blank means the shop derives it from the name.' },
  { header: 'seo_title_en', width: 30, note: '' },
  { header: 'seo_description_sq', width: 40, note: '' },
  { header: 'seo_description_en', width: 40, note: '' },
  { header: 'variants', width: 10, note: 'Read only. How many variants this product has.' },
  { header: 'images', width: 10, note: 'Read only. How many photographs it has.' },
];

/** Variant columns. `product_slug` plus `sku` is the key, and both are text so Excel cannot mangle them. */
export const VARIANT_COLUMNS: Column[] = [
  { header: 'product_slug', width: 30, text: true, note: 'Which product this variant belongs to. Must match a row on the Products sheet.' },
  { header: 'sku', width: 22, text: true, note: 'Identifies the variant within its product. Change it and you rename the SKU.' },
  { header: 'name_sq', width: 26, note: 'The variant name, e.g. 120 capsules.' },
  { header: 'name_en', width: 26, note: '' },
  { header: 'price', width: 12, number: true, note: 'In euro, VAT included. Type 9,90 or 9.90 — both work.' },
  { header: 'compare_at_price', width: 18, number: true, note: 'Higher than the price, or blank. Shows a struck-through was-price.' },
  { header: 'is_active', width: 12, note: 'yes or no. A published product needs at least one active variant.' },
  { header: 'is_default', width: 12, note: 'yes or no. Exactly one per product — the one shown first.' },
];

/**
 * The rules, in the file rather than on a page the operator has closed.
 *
 * Three things, because three is what somebody reads. The blank-cell rule is first because it is the only
 * one that can lose data.
 */
const HOW_TO: string[] = [
  'How to use this file',
  '',
  'Edit the cells, save as .xlsx, and upload it on the Products page. You will see exactly what',
  'would change before anything is written.',
  '',
  'Blank cells',
  '',
  '  A column you DELETE is left alone. Remove the description_en column and no description changes.',
  '  A cell you EMPTY in a column you kept is cleared. That is how you remove a subtitle.',
  '',
  '  So: to change only prices, delete every column except id and the price columns you need.',
  '  That is safer than emptying cells you did not mean to touch.',
  '',
  'The id column',
  '',
  '  It is what ties a row to a product. Never change it, never delete the column, never reorder',
  '  it away. You can edit the slug freely — the id is what does the matching, so renaming a web',
  '  address is just an edit rather than pointing the row somewhere else.',
  '',
  '  A row with no id is treated as a new product and refused unless it has a slug, a brand and',
  '  an Albanian name.',
  '',
  'What this file cannot do',
  '',
  '  Publish anything. status accepts draft, pending_review and archived; publishing needs',
  '  compliance to approve the product, which is deliberate and not a limitation of the file.',
  '',
  '  Change a published slug. The web address is in search results and in bookmarks.',
  '',
  '  Add or remove photographs. Use the Media tab on the product.',
];

const HEADER_FILL = 'FFEDF2EE';

function layout(sheet: ExcelJS.Worksheet, columns: Column[]): void {
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width,
    style: column.text ? { numFmt: '@' } : column.number ? { numFmt: '0.00' } : undefined,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  // So the header stays put while somebody scrolls seventy rows and twenty-seven columns.
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
}

/** `true`/`false` as `yes`/`no`, because a spreadsheet full of TRUE reads like a formula result. */
const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

export async function buildProductWorkbook(
  products: ProductExportRow[],
  variants: VariantExportRow[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BIOCODE';

  const sheet = workbook.addWorksheet('Products');
  layout(sheet, PRODUCT_COLUMNS);

  for (const row of products) {
    sheet.addRow({
      id: row.id,
      slug: row.slug,
      status: row.status,
      brand: row.brandSlug,
      name_sq: row.nameSq,
      name_en: row.nameEn,
      subtitle_sq: row.subtitleSq,
      subtitle_en: row.subtitleEn,
      description_sq: row.descriptionSq,
      description_en: row.descriptionEn,
      how_to_use_sq: row.howToUseSq,
      how_to_use_en: row.howToUseEn,
      warnings_sq: row.warningsSq,
      warnings_en: row.warningsEn,
      form: row.form,
      serving_size: row.servingSize,
      dietary_tags: row.dietaryTags,
      categories: row.categorySlugs,
      primary_category: row.primaryCategorySlug,
      goals: row.goalSlugs,
      is_featured: yesNo(row.isFeatured),
      seo_title_sq: row.seoTitleSq,
      seo_title_en: row.seoTitleEn,
      seo_description_sq: row.seoDescriptionSq,
      seo_description_en: row.seoDescriptionEn,
      variants: row.variantCount,
      images: row.imageCount,
    });
  }

  /*
   * The two read-only columns, greyed.
   *
   * They are counts rather than data, and an operator who types over one should be able to see that it was
   * never theirs to change. The importer ignores them regardless — this is the visual half of that.
   */
  const readOnly = PRODUCT_COLUMNS.map((column, index) => ({ column, index: index + 1 })).filter(
    ({ column }) => column.header === 'variants' || column.header === 'images',
  );
  for (const { index } of readOnly) {
    sheet.getColumn(index).font = { color: { argb: 'FF8A8F8B' } };
  }

  const variantSheet = workbook.addWorksheet('Variants');
  layout(variantSheet, VARIANT_COLUMNS);

  for (const row of variants) {
    variantSheet.addRow({
      product_slug: row.productSlug,
      sku: row.sku,
      name_sq: row.nameSq,
      name_en: row.nameEn,
      // Numbers, not strings — see the note at the top of this file.
      price: Number(row.price),
      compare_at_price: row.compareAtPrice === '' ? null : Number(row.compareAtPrice),
      is_active: yesNo(row.isActive),
      is_default: yesNo(row.isDefault),
    });
  }

  const notes = workbook.addWorksheet('How to use this file');
  notes.columns = [{ width: 104 }];
  for (const line of HOW_TO) notes.addRow([line]);
  notes.getRow(1).font = { bold: true, size: 13 };
  for (const heading of ['Blank cells', 'The id column', 'What this file cannot do']) {
    const found = HOW_TO.indexOf(heading);
    if (found >= 0) notes.getRow(found + 1).font = { bold: true };
  }

  notes.addRow([]);
  notes.addRow(['Products sheet']).font = { bold: true, size: 13 };
  for (const column of PRODUCT_COLUMNS) {
    if (column.note) notes.addRow([`${column.header} — ${column.note}`]);
  }
  notes.addRow([]);
  notes.addRow(['Variants sheet']).font = { bold: true, size: 13 };
  for (const column of VARIANT_COLUMNS) {
    if (column.note) notes.addRow([`${column.header} — ${column.note}`]);
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
