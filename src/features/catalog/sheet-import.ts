import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { auditMany } from '@/features/admin/audit';
import { productExportRows } from '@/features/catalog/sheet-export';
import {
  readBoolean,
  readFormCell,
  readList,
  readMoneyCell,
  readSlugCell,
  readStatusCell,
  readTagsCell,
} from '@/features/catalog/sheet-cells';
import type { ProductWorkbookRead, SheetRows } from '@/lib/sheet/product-read';
import type { Database, Json } from '@/lib/supabase/database.types';

/*
 * The patches are typed as the generated Update rows rather than as `Record<string, unknown>`.
 *
 * A loose record would not typecheck against `.update()` — correctly, because that is the check which
 * catches a column name this file spelled wrong. Naming the type keeps that guarantee while still letting
 * the patch be assembled field by field.
 */
type ProductPatch = Database['public']['Tables']['products']['Update'];
type VariantPatch = Database['public']['Tables']['product_variants']['Update'];

/**
 * Applying an edited catalogue workbook.
 *
 * ── Preview and apply are the same function ──
 *
 * `importProducts(read, { apply })` computes the whole plan and then either writes it or does not. Nothing
 * else differs between the two calls. That is deliberate and it is the main structural decision here: a
 * separate "preview" code path is a second implementation of the same rules, and the day they disagree is
 * the day somebody confirms a diff and gets a different result. The route calls this twice with the same
 * file — once to show, once to write — and re-derives rather than trusting a posted plan, so a file swapped
 * between the two steps is diffed afresh instead of applied blind.
 *
 * ── The diff is computed against the same projection the file was made from ──
 *
 * `productExportRows()` produced the download; it also produces the "current" side of every comparison
 * here. So a cell nobody touched is provably equal to what is stored, and "no change" means no change
 * rather than "no change we happened to look at". It also means round-tripping an untouched file is a
 * no-op, which is the property that makes the feature safe to try.
 *
 * ── The blank rule ──
 *
 * A column **absent** from the sheet is not touched. A column **present** with an empty cell is cleared.
 * `SheetRows.headers` is what distinguishes them, which is why the reader returns it. See
 * `lib/sheet/product-workbook.ts` for why neither cell-level rule works on its own.
 *
 * ── Where the per-cell rules live ──
 *
 * In `sheet-cells.ts`, returning a verdict and the sentence to show. This file walks the rows, resolves the
 * things that need the database (a brand slug, a category slug), and writes. Anything decidable from the cell
 * alone is over there, where a test can reach it without a Supabase client.
 */

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface RowPlan {
  /** Row number as the operator sees it in Excel, header included. */
  row: number;
  label: string;
  changes: FieldChange[];
}

export interface RowProblem {
  sheet: 'Products' | 'Variants';
  row: number;
  label: string;
  problem: string;
}

export interface ImportPlan {
  products: RowPlan[];
  variants: RowPlan[];
  problems: RowProblem[];
  /** Rows read and understood that ask for nothing. */
  unchanged: number;
  /** Set once the plan has been written. */
  applied: boolean;
}

const EMPTY_PLAN: ImportPlan = {
  products: [],
  variants: [],
  problems: [],
  unchanged: 0,
  applied: false,
};

/**
 * Which of a row's columns were actually in the file.
 *
 * A `Set` rather than repeated `includes`, because this is asked once per field per row — 27 columns times
 * 70 rows — and because reading `has` at the point of use says what it means.
 */
function presence(sheet: SheetRows): Set<string> {
  return new Set(sheet.headers);
}

export async function importProducts(
  read: ProductWorkbookRead,
  options: { apply: boolean; actorId: string },
): Promise<ImportPlan> {
  if (!read.ok) return EMPTY_PLAN;

  try {
    const supabase = await createClient();

    // The same projection that produced the download, so an untouched file diffs to nothing.
    const { products: current, variants: currentVariants } = await productExportRows();
    const byId = new Map(current.map((row) => [row.id, row]));
    const variantKey = (productSlug: string, sku: string) => `${productSlug}::${sku}`;
    const variantById = new Map(
      currentVariants.map((row) => [variantKey(row.productSlug, row.sku), row]),
    );

    const [{ data: brandRows }, { data: categoryRows }, { data: goalRows }] = await Promise.all([
      supabase.from('brands').select('id, slug').is('deleted_at', null),
      supabase.from('categories').select('id, slug').is('deleted_at', null),
      supabase.from('health_goals').select('id, slug'),
    ]);
    const brandId = new Map(
      ((brandRows ?? []) as { id: string; slug: string }[]).map((row) => [row.slug, row.id]),
    );
    const categoryId = new Map(
      ((categoryRows ?? []) as { id: string; slug: string }[]).map((row) => [row.slug, row.id]),
    );
    const goalId = new Map(
      ((goalRows ?? []) as { id: string; slug: string }[]).map((row) => [row.slug, row.id]),
    );

    const plan: ImportPlan = { products: [], variants: [], problems: [], unchanged: 0, applied: false };
    const has = presence(read.products);

    /** Accumulated writes, so a preview computes them and only an apply sends them. */
    const productWrites: { id: string; patch: ProductPatch; changes: FieldChange[] }[] = [];
    const categoryWrites: { id: string; links: { category_id: string; is_primary: boolean }[] }[] = [];
    const goalWrites: { id: string; goalIds: string[] }[] = [];

    read.products.rows.forEach((row, index) => {
      // +2: one for the header, one because a person counts from 1.
      const excelRow = index + 2;
      const id = (row.id ?? '').trim();
      const existing = id ? byId.get(id) : undefined;
      const label = row.name_sq || row.slug || id.slice(0, 8) || `row ${excelRow}`;

      const refuse = (problem: string) =>
        plan.problems.push({ sheet: 'Products', row: excelRow, label, problem });

      if (!id) {
        /*
         * Creating products from the sheet is not supported, and this is the honest cut rather than an
         * oversight: a new product needs a slug nobody has used, a brand, an Albanian name, and then a
         * variant with a unique SKU before it is anything. That is the create form's job, and doing it
         * here would mean a typo in the id column silently minting duplicates of the catalogue.
         */
        refuse('No id. This file only updates existing products — add new ones on the Products page.');
        return;
      }
      if (!existing) {
        refuse('That id is not in the catalogue. It may have been removed since the file was downloaded.');
        return;
      }

      const changes: FieldChange[] = [];
      const patch: ProductPatch = {};

      /** Records a change only when the value actually differs from what is stored. */
      const set = (field: string, column: string, from: string, to: string, write: () => void) => {
        if (!has.has(column)) return;
        if (from === to) return;
        changes.push({ field, from, to });
        write();
      };

      // ── slug ──
      if (has.has('slug')) {
        const verdict = readSlugCell(row.slug ?? '', existing.slug, {
          published: existing.status === 'published',
        });
        if (verdict.kind === 'refuse') {
          refuse(verdict.problem);
          return;
        }
        if (verdict.kind === 'set') {
          changes.push({ field: 'slug', from: existing.slug, to: verdict.value });
          patch.slug = verdict.value;
        }
      }

      // ── status ──
      if (has.has('status')) {
        const verdict = readStatusCell(row.status ?? '', existing.status);
        if (verdict.kind === 'refuse') {
          refuse(verdict.problem);
          return;
        }
        if (verdict.kind === 'set') {
          changes.push({ field: 'status', from: existing.status, to: verdict.value });
          patch.status = verdict.value;
        }
      }

      // ── brand ──
      if (has.has('brand')) {
        const next = (row.brand ?? '').trim();
        if (next !== existing.brandSlug) {
          const resolved = brandId.get(next);
          if (!resolved) {
            refuse(`There is no brand with the slug "${next}".`);
            return;
          }
          changes.push({ field: 'brand', from: existing.brandSlug, to: next });
          patch.brand_id = resolved;
        }
      }

      /*
       * Bilingual fields, merged rather than replaced.
       *
       * Each is one jsonb column written from two columns in the sheet, and either may be absent. So the
       * value written is "whichever halves the file carried, falling back to what is stored" — otherwise
       * deleting the `_en` column would silently clear every English translation.
       *
       * An empty string is written as an **absent key**, not as `''`, because `pickLocale` falls back on
       * absence: storing `en: ''` would hand an English reader a confident blank where Albanian text exists.
       */
      const bilingual = (
        field: string,
        column: string,
        dbColumn: string,
        currentSq: string,
        currentEn: string,
      ) => {
        const sqColumn = `${column}_sq`;
        const enColumn = `${column}_en`;
        if (!has.has(sqColumn) && !has.has(enColumn)) return;

        const nextSq = has.has(sqColumn) ? (row[sqColumn] ?? '').trim() : currentSq;
        const nextEn = has.has(enColumn) ? (row[enColumn] ?? '').trim() : currentEn;

        if (field === 'name' && nextSq.length === 0) {
          refuse('A product must have an Albanian name. Leave the cell filled or delete the column.');
          return;
        }
        if (nextSq === currentSq && nextEn === currentEn) return;

        const value: Record<string, string> = {};
        if (nextSq) value.sq = nextSq;
        if (nextEn) value.en = nextEn;

        if (nextSq !== currentSq) changes.push({ field: `${field} (sq)`, from: currentSq, to: nextSq });
        if (nextEn !== currentEn) changes.push({ field: `${field} (en)`, from: currentEn, to: nextEn });
        (patch as Record<string, Json>)[dbColumn] = value as unknown as Json;
      };

      bilingual('name', 'name', 'name', existing.nameSq, existing.nameEn);
      if (plan.problems.some((problem) => problem.row === excelRow)) return;
      bilingual('subtitle', 'subtitle', 'subtitle', existing.subtitleSq, existing.subtitleEn);
      bilingual('description', 'description', 'description', existing.descriptionSq, existing.descriptionEn);
      bilingual('how to use', 'how_to_use', 'how_to_use', existing.howToUseSq, existing.howToUseEn);
      bilingual('warnings', 'warnings', 'warnings', existing.warningsSq, existing.warningsEn);

      // ── form ──
      if (has.has('form')) {
        const verdict = readFormCell(row.form ?? '', existing.form);
        if (verdict.kind === 'refuse') {
          refuse(verdict.problem);
          return;
        }
        if (verdict.kind === 'set') {
          changes.push({ field: 'form', from: existing.form, to: verdict.value ?? '' });
          patch.form = verdict.value;
        }
      }

      set('serving size', 'serving_size', existing.servingSize, (row.serving_size ?? '').trim(), () => {
        patch.serving_size = (row.serving_size ?? '').trim() || null;
      });

      // ── dietary tags ──
      if (has.has('dietary_tags')) {
        const verdict = readTagsCell(row.dietary_tags ?? '', existing.dietaryTags);
        if (verdict.kind === 'refuse') {
          refuse(verdict.problem);
          return;
        }
        if (verdict.kind === 'set') {
          changes.push({
            field: 'dietary tags',
            from: readList(existing.dietaryTags).join(', '),
            to: verdict.value.join(', '),
          });
          patch.dietary_tags = verdict.value;
        }
      }

      // ── is_featured ──
      if (has.has('is_featured')) {
        const next = readBoolean(row.is_featured ?? '');
        if (next === null) {
          refuse(`"${row.is_featured}" is not yes or no.`);
          return;
        }
        if (next !== existing.isFeatured) {
          changes.push({
            field: 'featured',
            from: existing.isFeatured ? 'yes' : 'no',
            to: next ? 'yes' : 'no',
          });
          patch.is_featured = next;
        }
      }

      /*
       * SEO, one jsonb column written from four sheet columns.
       *
       * Merged the same way the bilingual fields are, and for the same reason — the file may carry any
       * subset of the four.
       */
      if (
        ['seo_title_sq', 'seo_title_en', 'seo_description_sq', 'seo_description_en'].some((column) =>
          has.has(column),
        )
      ) {
        const pick = (column: string, fallback: string) =>
          has.has(column) ? (row[column] ?? '').trim() : fallback;
        const titleSq = pick('seo_title_sq', existing.seoTitleSq);
        const titleEn = pick('seo_title_en', existing.seoTitleEn);
        const descSq = pick('seo_description_sq', existing.seoDescriptionSq);
        const descEn = pick('seo_description_en', existing.seoDescriptionEn);

        const differs =
          titleSq !== existing.seoTitleSq ||
          titleEn !== existing.seoTitleEn ||
          descSq !== existing.seoDescriptionSq ||
          descEn !== existing.seoDescriptionEn;

        if (differs) {
          const title: Record<string, string> = {};
          if (titleSq) title.sq = titleSq;
          if (titleEn) title.en = titleEn;
          const description: Record<string, string> = {};
          if (descSq) description.sq = descSq;
          if (descEn) description.en = descEn;

          changes.push({
            field: 'search engine text',
            from: [existing.seoTitleSq, existing.seoDescriptionSq].filter(Boolean).join(' / '),
            to: [titleSq, descSq].filter(Boolean).join(' / '),
          });
          patch.seo = { title, description } as unknown as Json;
        }
      }

      // ── categories and goals: replace-all, the same semantics the editor uses ──
      if (has.has('categories') || has.has('primary_category')) {
        const slugs = has.has('categories')
          ? readList(row.categories ?? '')
          : readList(existing.categorySlugs);
        const primary = has.has('primary_category')
          ? (row.primary_category ?? '').trim()
          : existing.primaryCategorySlug;

        const unknown = slugs.filter((slug) => !categoryId.has(slug));
        if (unknown.length > 0) {
          refuse(`There is no category with the slug: ${unknown.join(', ')}.`);
          return;
        }
        if (primary && !slugs.includes(primary)) {
          refuse(`The primary category "${primary}" is not in the categories column for this row.`);
          return;
        }

        const beforeSlugs = readList(existing.categorySlugs);
        if (
          slugs.join(',') !== beforeSlugs.join(',') ||
          primary !== existing.primaryCategorySlug
        ) {
          changes.push({
            field: 'categories',
            from: `${beforeSlugs.join(', ')}${existing.primaryCategorySlug ? ` (primary ${existing.primaryCategorySlug})` : ''}`,
            to: `${slugs.join(', ')}${primary ? ` (primary ${primary})` : ''}`,
          });
          categoryWrites.push({
            id,
            links: slugs.map((slug) => ({
              category_id: categoryId.get(slug) as string,
              is_primary: slug === primary,
            })),
          });
        }
      }

      if (has.has('goals')) {
        const slugs = readList(row.goals ?? '');
        const unknown = slugs.filter((slug) => !goalId.has(slug));
        if (unknown.length > 0) {
          refuse(`There is no health goal with the slug: ${unknown.join(', ')}.`);
          return;
        }
        const before = readList(existing.goalSlugs);
        if (slugs.join(',') !== before.join(',')) {
          changes.push({ field: 'health goals', from: before.join(', '), to: slugs.join(', ') });
          goalWrites.push({ id, goalIds: slugs.map((slug) => goalId.get(slug) as string) });
        }
      }

      if (changes.length === 0) {
        plan.unchanged += 1;
        return;
      }

      plan.products.push({ row: excelRow, label, changes });
      if (Object.keys(patch).length > 0) productWrites.push({ id, patch, changes });
    });

    // ── Variants ──
    const variantHas = presence(read.variants);
    const variantWrites: {
      productSlug: string;
      sku: string;
      patch: VariantPatch;
      changes: FieldChange[];
    }[] = [];

    read.variants.rows.forEach((row, index) => {
      const excelRow = index + 2;
      const productSlug = (row.product_slug ?? '').trim();
      const sku = (row.sku ?? '').trim();
      const label = sku || `row ${excelRow}`;
      const refuse = (problem: string) =>
        plan.problems.push({ sheet: 'Variants', row: excelRow, label, problem });

      if (!productSlug || !sku) {
        refuse('Both product_slug and sku are needed to find the variant.');
        return;
      }
      const existing = variantById.get(variantKey(productSlug, sku));
      if (!existing) {
        /*
         * Creating variants from the sheet is not supported in v1. A SKU is globally unique and
         * `one_default_variant` is a partial unique index, so a new row can fail in two ways that need a
         * conversation rather than a report line — and the common case by far is repricing what exists.
         */
        refuse(
          `No variant "${sku}" on "${productSlug}". This file updates existing variants; add new ones on the product page.`,
        );
        return;
      }

      const changes: FieldChange[] = [];
      const patch: VariantPatch = {};

      /** Returns false when the row must be abandoned. Rules and messages in `sheet-cells.ts`. */
      const money = (column: 'price' | 'compare_at_price', field: string, currentValue: string) => {
        if (!variantHas.has(column)) return true;
        const raw = (row[column] ?? '').trim();
        const verdict = readMoneyCell(raw, currentValue, { required: column === 'price' });

        if (verdict.kind === 'refuse') {
          refuse(verdict.problem);
          return false;
        }
        if (verdict.kind === 'same') return true;
        if (verdict.kind === 'clear') {
          changes.push({ field, from: currentValue, to: '—' });
          patch.compare_at_price_cents = null;
          return true;
        }

        // Shown as typed, so the line the operator reads is the cell they edited.
        changes.push({ field, from: currentValue, to: raw });
        if (column === 'price') patch.price_cents = verdict.cents;
        else patch.compare_at_price_cents = verdict.cents;
        return true;
      };

      if (!money('price', 'price', existing.price)) return;
      if (!money('compare_at_price', 'compare-at price', existing.compareAtPrice)) return;

      if (variantHas.has('name_sq') || variantHas.has('name_en')) {
        const nextSq = variantHas.has('name_sq') ? (row.name_sq ?? '').trim() : existing.nameSq;
        const nextEn = variantHas.has('name_en') ? (row.name_en ?? '').trim() : existing.nameEn;
        if (nextSq !== existing.nameSq || nextEn !== existing.nameEn) {
          const value: Record<string, string> = {};
          if (nextSq) value.sq = nextSq;
          if (nextEn) value.en = nextEn;
          changes.push({ field: 'variant name', from: existing.nameSq, to: nextSq });
          patch.name = value;
        }
      }

      for (const [column, field, currentValue] of [
        ['is_active', 'active', existing.isActive],
        ['is_default', 'default', existing.isDefault],
      ] as const) {
        if (!variantHas.has(column)) continue;
        const next = readBoolean(row[column] ?? '');
        if (next === null) {
          refuse(`"${row[column]}" is not yes or no.`);
          return;
        }
        if (next !== currentValue) {
          changes.push({ field, from: currentValue ? 'yes' : 'no', to: next ? 'yes' : 'no' });
          if (column === 'is_active') patch.is_active = next;
          else patch.is_default = next;
        }
      }

      if (changes.length === 0) {
        plan.unchanged += 1;
        return;
      }
      plan.variants.push({ row: excelRow, label: `${productSlug} · ${sku}`, changes });
      variantWrites.push({ productSlug, sku, patch, changes });
    });

    if (!options.apply) return plan;

    // ── Write ──
    const slugs = new Set<string>();

    for (const write of productWrites) {
      const { error } = await supabase.from('products').update(write.patch).eq('id', write.id);
      if (error) {
        plan.problems.push({
          sheet: 'Products',
          row: 0,
          label: byId.get(write.id)?.slug ?? write.id.slice(0, 8),
          problem: error.message.includes('duplicate key')
            ? 'Another product already uses that web address.'
            : 'Could not be saved.',
        });
        continue;
      }
      slugs.add((write.patch.slug as string | undefined) ?? byId.get(write.id)?.slug ?? '');
    }

    /*
     * Category and goal links are replace-all, exactly as `saveProductGeneral` does it: both tables are
     * pure join rows with no data of their own, so delete-then-insert is atomic enough for a save and
     * avoids a three-way diff longer than the thing it optimises.
     */
    for (const write of categoryWrites) {
      await supabase.from('product_categories').delete().eq('product_id', write.id);
      if (write.links.length > 0) {
        await supabase
          .from('product_categories')
          .insert(write.links.map((link) => ({ product_id: write.id, ...link })));
      }
    }
    for (const write of goalWrites) {
      await supabase.from('product_health_goals').delete().eq('product_id', write.id);
      if (write.goalIds.length > 0) {
        await supabase
          .from('product_health_goals')
          .insert(write.goalIds.map((goalId) => ({ product_id: write.id, goal_id: goalId })));
      }
    }

    for (const write of variantWrites) {
      const product = current.find((row) => row.slug === write.productSlug);
      if (!product) continue;
      const { error } = await supabase
        .from('product_variants')
        .update(write.patch)
        .eq('product_id', product.id)
        .eq('sku', write.sku);
      if (error) {
        plan.problems.push({
          sheet: 'Variants',
          row: 0,
          label: `${write.productSlug} · ${write.sku}`,
          problem: 'Could not be saved.',
        });
        continue;
      }
      slugs.add(write.productSlug);
    }

    /*
     * One audit row per product, with the field-level diff as `after`.
     *
     * The whole point of auditing an import is that somebody can answer "what did that file do to the
     * price of this product?" — a single summary row could not. The shared `import_id` groups them.
     */
    const importId = crypto.randomUUID();
    await auditMany(
      'product.updated',
      'product',
      productWrites.map((write) => ({
        entityId: write.id,
        before: null,
        after: { changes: write.changes, sheet_import: true, import_id: importId } as unknown as Json,
      })),
    );

    plan.applied = true;
    logger.info('product sheet import applied', {
      products: productWrites.length,
      variants: variantWrites.length,
      problems: plan.problems.length,
      actorId: options.actorId,
      importId,
    });

    return { ...plan, touchedSlugs: [...slugs].filter(Boolean) } as ImportPlan & {
      touchedSlugs: string[];
    };
  } catch (error) {
    logger.error('importProducts threw', describeError(error));
    return EMPTY_PLAN;
  }
}
