'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/money';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import { fieldErrorsFrom } from '@/lib/field-errors';
import { audit, auditMany, requireCapability } from '@/features/admin/audit';
import { productAttachments } from '@/features/catalog/admin-queries';
import {
  approveProductSchema,
  CATALOG_FIELD_MESSAGES,
  createProductSchema,
  deleteVariantSchema,
  productBulkSchema,
  productGeneralSchema,
  productIdSchema,
  productSeoSchema,
  productStatusSchema,
  rejectProductSchema,
  variantSchema,
} from '@/features/catalog/admin-schemas';
import { canPurge, canRemovePublished } from '@/features/catalog/removal';
import { FORM_LEVEL } from '@/lib/field-errors';
import type { Database, Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §3 — catalogue mutations.
 *
 * Thin for the same reason the order actions are: migration 14 owns the publish invariants
 * (approval, ≥1 active variant, ≥1 image, a primary category) and slug immutability, so this
 * validates shape, writes, audits, and purges caches. It does not re-implement the rules — the
 * one place it *anticipates* them is the editor's blocker checklist, which exists to explain
 * rather than to enforce.
 *
 * Every mutation that touches published content calls `revalidatePublic`. Missing that is the
 * defect an operator reports as "I changed the price and the site still shows the old one",
 * and it is invisible in development where nothing is cached.
 */

export type CatalogErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.catalog.errors.checkFields'
  | 'admin.catalog.errors.notFound'
  | 'admin.catalog.errors.slugTaken'
  | 'admin.catalog.errors.slugLocked'
  | 'admin.catalog.errors.skuTaken'
  | 'admin.catalog.errors.invalidPrice'
  | 'admin.catalog.errors.publishBlocked'
  | 'admin.catalog.errors.lastVariant'
  | 'admin.catalog.errors.duplicateIngredient'
  /**
   * A removal the rules refuse.
   *
   * The specific reason travels in `fieldErrors._form` rather than in a key per rule: "3 products still
   * use this brand" carries a count, and a keyed message cannot. The key is what tells the component to
   * look there.
   */
  | 'admin.catalog.errors.removeBlocked';

/**
 * The failure branch carries `values` as well as `fieldErrors`.
 *
 * `ActionResult` deliberately has no slot for the submitted payload — most forms in this
 * codebase are rendered from data that is already on the server, so re-reading gives the right
 * defaults. A **create** form has nothing on the server yet: everything the operator typed
 * exists only in the request that just failed, and dropping it means retyping from scratch.
 */
export type CatalogState =
  | { ok: true; data: { id?: string } }
  | {
      ok: false;
      error: CatalogErrorKey;
      fieldErrors?: Record<string, string[]>;
      values?: Record<string, string>;
    }
  | null;

function catalogFail(error: CatalogErrorKey): CatalogState {
  return fail<CatalogErrorKey, { id?: string }>(error);
}

/**
 * Attaches what was submitted to a failure, so the form can repopulate.
 *
 * Non-string entries (a `File`, say) are dropped rather than coerced — `String(file)` would put
 * "[object File]" in a text input, which looks like corruption rather than a preserved value.
 * Values are also clamped, because on a validation failure they are arbitrary submitted strings.
 */
function withValues(state: CatalogState, submitted: Record<string, FormDataEntryValue>) {
  if (!state || state.ok) return state;

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (typeof value === 'string') values[key] = value.slice(0, 500);
  }

  return { ...state, values };
}

/**
 * Postgres error → message key.
 *
 * The publish guard's four exceptions all map to one key: the editor already shows a checklist
 * naming exactly which condition is unmet, so repeating it in an alert would be noise. The
 * exception is the backstop for a race, not the normal path.
 */
function mapCatalogError(message: string): CatalogErrorKey {
  if (message.includes('SLUG_IMMUTABLE_AFTER_PUBLISH')) return 'admin.catalog.errors.slugLocked';
  if (message.includes('PUBLISH_REQUIRES')) return 'admin.catalog.errors.publishBlocked';
  if (message.includes('duplicate key') && message.includes('sku')) {
    return 'admin.catalog.errors.skuTaken';
  }
  if (message.includes('duplicate key') && message.includes('slug')) {
    return 'admin.catalog.errors.slugTaken';
  }
  return 'admin.errors.generic';
}

/**
 * Purges everything a product change can affect.
 *
 * Deliberately broad. A product appears on its own page, the listing, its category, its brand,
 * every goal it belongs to and the home page — and working out the minimal set per edit is the
 * kind of cleverness that eventually misses one and serves a stale price. Tag purges are cheap;
 * a wrong price is not.
 */
function revalidateProduct(slug: string): void {
  revalidatePublic([
    CACHE_TAGS.products,
    CACHE_TAGS.product(slug),
    CACHE_TAGS.categories,
    CACHE_TAGS.brands,
    CACHE_TAGS.goals,
  ]);
  revalidatePath('/admin/products');
}

/** docs/06 §3.1 — save the General tab. */
export async function saveProductGeneral(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const raw = Object.fromEntries(formData);

  const parsed = productGeneralSchema.safeParse({
    ...raw,
    name: { sq: raw['name.sq'], en: raw['name.en'] },
    subtitle: { sq: raw['subtitle.sq'], en: raw['subtitle.en'] },
    description: { sq: raw['description.sq'], en: raw['description.en'] },
    howToUse: { sq: raw['howToUse.sq'], en: raw['howToUse.en'] },
    warnings: { sq: raw['warnings.sq'], en: raw['warnings.en'] },
    // Checkbox groups arrive as repeated fields, which `Object.fromEntries` collapses to one.
    dietaryTags: formData.getAll('dietaryTags'),
    categoryIds: formData.getAll('categoryIds'),
    goalIds: formData.getAll('goalIds'),
  });

  if (!parsed.success) {
    /*
     * The field errors are **returned**, not just logged.
     *
     * They used to be computed here, written to the log, and thrown away — the editor got
     * "Check the fields marked below" with nothing marked below, which is the copy promising something
     * the code did not do. Worse, `flatten().fieldErrors` could not have marked them anyway: it names
     * only top-level keys, so both halves of a bilingual field collapse to one `name` entry (probed
     * against Zod 4.4.3 — see `lib/field-errors.ts`). `fieldErrorsFrom` keys on the joined issue path
     * instead, which yields `name.sq` — the input's own `name` attribute, so the lookup is direct.
     */
    return fromFieldErrors<CatalogErrorKey, { id?: string }>('admin.catalog.errors.checkFields', {
      fieldErrors: fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES),
    });
  }

  const input = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('products')
      .select('slug, status, name')
      .eq('id', input.productId)
      .maybeSingle();

    if (!before) return catalogFail('admin.catalog.errors.notFound');
    const previous = before as { slug: string; status: string; name: unknown };

    /*
     * jsonb columns take `{sq, en}`. Empty English is stored as an absent key rather than an
     * empty string so `pickLocale` falls back to Albanian — an empty string is a *present*
     * value and would render as blank rather than falling through.
     */
    const bilingual = (value: { sq: string; en?: string }) =>
      value.en ? { sq: value.sq, en: value.en } : { sq: value.sq };

    const { error } = await supabase
      .from('products')
      .update({
        slug: input.slug,
        brand_id: input.brandId,
        name: bilingual(input.name),
        subtitle: bilingual(input.subtitle),
        description: bilingual(input.description),
        how_to_use: bilingual(input.howToUse),
        warnings: bilingual(input.warnings),
        form: input.form || null,
        serving_size: input.servingSize || null,
        dietary_tags: input.dietaryTags,
        is_featured: input.isFeatured,
      })
      .eq('id', input.productId);

    if (error) {
      logger.info('Product update rejected', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    /*
     * Category and goal links are replace-all rather than diffed. Both tables are pure join
     * rows with no data of their own, so delete-then-insert is atomic enough for a form save
     * and avoids a three-way diff that would be longer than the thing it optimises.
     */
    await supabase.from('product_categories').delete().eq('product_id', input.productId);
    if (input.categoryIds.length > 0) {
      await supabase.from('product_categories').insert(
        input.categoryIds.map((categoryId) => ({
          product_id: input.productId,
          category_id: categoryId,
          is_primary: categoryId === input.primaryCategoryId,
        })),
      );
    }

    await supabase.from('product_health_goals').delete().eq('product_id', input.productId);
    if (input.goalIds.length > 0) {
      await supabase
        .from('product_health_goals')
        .insert(input.goalIds.map((goalId) => ({ product_id: input.productId, goal_id: goalId })));
    }

    await audit('product.updated', 'product', input.productId, previous, {
      slug: input.slug,
      name: input.name,
    });

    // Both slugs: if the slug changed on a draft, the old page must go too.
    revalidateProduct(input.slug);
    if (previous.slug !== input.slug) revalidatePublic([CACHE_TAGS.product(previous.slug)]);
    revalidatePath(`/admin/products/${input.productId}`);

    return ok({ id: input.productId });
  } catch (error) {
    logger.error('saveProductGeneral threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * Removes a product from the panel — reversibly.
 *
 * Sets `deleted_at`. That is all it takes to remove it from the storefront too: `p_read on products` is
 * `(status = 'published' and deleted_at is null)`, so the public site, the sitemap and every anonymous
 * read drop it at the database rather than because some query remembered to filter. Nothing is destroyed
 * and `restoreProduct` puts it back exactly as it was.
 *
 * Refuses a published product. Archiving is the control for "take it off sale", it already exists, and it
 * is already reversible — see `canRemovePublished` for why keeping the two apart is worth a second click.
 *
 * The impact figures are read *before* the write so the operator can be told what a removal costs them,
 * and they are reported afterwards rather than blocking: a merchant offer going unsellable is a
 * consequence to know about, not a reason to refuse.
 */
export async function removeProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');
  const { productId } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('products')
      .select('slug, status, name, deleted_at')
      .eq('id', productId)
      .maybeSingle();

    if (!before) return catalogFail('admin.catalog.errors.notFound');
    const product = before as { slug: string; status: string; name: unknown; deleted_at: string | null };

    // Already gone. Not an error worth alarming anyone with — a double-submitted form, most likely.
    if (product.deleted_at !== null) return ok({ id: productId });

    const verdict = canRemovePublished(product.status, 'product');
    if (!verdict.allowed) {
      return fromFieldErrors<CatalogErrorKey, { id?: string }>(
        'admin.catalog.errors.removeBlocked',
        { fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) } },
      );
    }

    const { error } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', productId)
      /*
       * Guarded on the status *and* on not-already-removed, so a stale tab cannot remove a product that
       * has been published since the page loaded — the check above would have passed against old data.
       */
      .neq('status', 'published')
      .is('deleted_at', null);

    if (error) {
      logger.error('removeProduct failed', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    await audit('product.removed', 'product', productId, { status: product.status }, {
      slug: product.slug,
      name: product.name,
    });

    revalidateProduct(product.slug);
    revalidatePath(`/admin/products/${productId}`);
    return ok({ id: productId });
  } catch (error) {
    logger.error('removeProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * Puts a removed product back.
 *
 * It returns at whatever status it held, which is never `published` — the removal refused that — so a
 * restore cannot put something on the storefront by surprise. The slug is still its own, because a
 * removed row keeps its `unique` claim on it, so this can never collide.
 */
export async function restoreProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');
  const { productId } = parsed.data;

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('products')
      .update({ deleted_at: null })
      .eq('id', productId)
      .not('deleted_at', 'is', null)
      .select('slug, status')
      .maybeSingle();

    if (error) {
      logger.error('restoreProduct failed', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }
    // No row means it was not removed in the first place, which is the state the caller wanted anyway.
    if (!data) return ok({ id: productId });

    const restored = data as { slug: string; status: string };
    await audit('product.restored', 'product', productId, null, { slug: restored.slug });

    revalidateProduct(restored.slug);
    revalidatePath(`/admin/products/${productId}`);
    return ok({ id: productId });
  } catch (error) {
    logger.error('restoreProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * Destroys a removed product for good.
 *
 * Only from the bin, and only when nothing is attached. Removal already achieves everything an operator
 * normally wants; this adds exactly one thing, which is that the slug becomes reusable. So it is a second
 * deliberate step rather than an alternative, and it is refused unless the record is genuinely empty.
 *
 * ── What "empty" means, and why ──
 *
 * Proven by executing it: a product with one stock movement is refused by Postgres, because the cascade
 * to `product_variants` is itself blocked by `stock_movements_variant_id_fkey`. But *succeeding* is the
 * case worth guarding, since thirteen tables cascade — including customer reviews and merchant offers,
 * which would go with no audit row of their own. `productAttachments` counts every one of those and
 * `canPurge` names them all at once, because clearing one blocker only to be refused by the next is the
 * worst version of this.
 *
 * What is allowed to go with it: the product's own images, category and goal links, ingredient rows and
 * certifications. None of those means anything without the product.
 */
export async function purgeProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');
  const { productId } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('products')
      .select('slug, status, name, deleted_at')
      .eq('id', productId)
      .maybeSingle();

    if (!before) return catalogFail('admin.catalog.errors.notFound');
    const product = before as {
      slug: string;
      status: string;
      name: unknown;
      deleted_at: string | null;
    };

    /*
     * The bin is the only door. A product still in the catalogue must be removed first — which is a
     * reversible step that gives the operator a chance to notice they did not mean it, and which puts
     * the record somewhere they have to go back to deliberately.
     */
    if (product.deleted_at === null) {
      return fromFieldErrors<CatalogErrorKey, { id?: string }>(
        'admin.catalog.errors.removeBlocked',
        {
          fieldErrors: {
            [FORM_LEVEL]: [
              'This product is still in the catalogue.',
              'Remove it first. Deleting for good is only possible from the Removed list.',
            ],
          },
        },
      );
    }

    const attached = await productAttachments(productId);
    const verdict = canPurge(attached);
    if (!verdict.allowed) {
      return fromFieldErrors<CatalogErrorKey, { id?: string }>(
        'admin.catalog.errors.removeBlocked',
        { fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) } },
      );
    }

    /*
     * Audited before the delete: afterwards there is nothing left to read, and this row is the only
     * remaining record that the product existed. The attachment counts go in too, as evidence of what
     * the check saw at the moment it allowed this.
     */
    await audit(
      'product.purged',
      'product',
      productId,
      { slug: product.slug, status: product.status, name: product.name },
      { attached } as unknown as Json,
    );

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      // Guarded, so a product restored since the page loaded is not destroyed on a stale check.
      .not('deleted_at', 'is', null);

    if (error) {
      logger.error('purgeProduct failed', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    revalidateProduct(product.slug);
    return ok({ id: productId });
  } catch (error) {
    logger.error('purgeProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * docs/06 §3 — "Row actions: edit, duplicate, archive". The duplicate half, finally.
 *
 * A new product is three fields; a *near-copy* of an existing one is forty, spread over five tabs. Two
 * flavours of the same supplement, or a 60-capsule beside a 120, is the ordinary case in this catalogue
 * and there was no way to do it but retype.
 *
 * ── What is copied, and what deliberately is not ──
 *
 * Copied: every descriptive field, the form and serving size, dietary tags, category and goal links, the
 * ingredient label and the certifications. Those are what make it a duplicate rather than a blank.
 *
 * **Not** copied, each for a reason:
 *   - `status` — the copy is always a draft. A duplicate that arrived published would put an unreviewed
 *     page on the shop, and `guard_product_publish` would have been bypassed by the fact that its source
 *     had already passed.
 *   - `approved_by` / `approved_at` / `published_at` — an approval is a decision about a specific
 *     product. Carrying it over would let a copy inherit a compliance sign-off nobody gave it, which is
 *     the same defect as the one `rejectProduct` had.
 *   - variants — a variant carries a SKU, and a SKU is unique, printed on courier forms and scanned. A
 *     generated one (`SKU-COPY`) would look real and be wrong. The copy needs at least one variant to
 *     publish, so the editor is where the operator sets the price anyway.
 *   - images — they live in storage, and copying bytes is a per-file round trip that belongs with the
 *     media tab rather than hidden inside a duplicate. The blocker checklist will say an image is needed.
 *   - `rating_avg` / `rating_count` and reviews — those belong to the product customers reviewed.
 */
export async function duplicateProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');
  const { productId } = parsed.data;

  try {
    const supabase = await createClient();

    const { data: source } = await supabase
      .from('products')
      .select(
        `slug, brand_id, name, subtitle, description, how_to_use, warnings, form, serving_size,
         dietary_tags, seo`,
      )
      .eq('id', productId)
      .is('deleted_at', null)
      .maybeSingle();

    if (!source) return catalogFail('admin.catalog.errors.notFound');
    const row = source as Record<string, unknown> & { slug: string; name: unknown };

    /*
     * `-copy`, then `-copy-2`, and so on.
     *
     * A removed product still holds its slug — the unique constraint has no partial index — so the first
     * free suffix has to be found by asking rather than assumed. Capped at ten: past that the operator is
     * duplicating in a loop and a clearer error is kinder than a twelfth silent suffix.
     */
    let slug = '';
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const candidate = attempt === 1 ? `${row.slug}-copy` : `${row.slug}-copy-${attempt}`;
      const { data: taken } = await supabase
        .from('products')
        .select('id')
        .eq('slug', candidate)
        .maybeSingle();
      if (!taken) {
        slug = candidate;
        break;
      }
    }
    if (!slug) return catalogFail('admin.catalog.errors.slugTaken');

    const asName = (value: unknown): Record<string, string> => {
      const pair = (value ?? {}) as Record<string, string>;
      const out: Record<string, string> = {};
      // "(copy)" on both locales that exist, so the list is readable before anything is renamed.
      if (pair.sq) out.sq = `${pair.sq} (copy)`;
      if (pair.en) out.en = `${pair.en} (copy)`;
      return out;
    };

    const { data: created, error } = await supabase
      .from('products')
      .insert({
        slug,
        brand_id: row.brand_id as string,
        name: asName(row.name) as unknown as Json,
        subtitle: (row.subtitle ?? {}) as Json,
        description: (row.description ?? {}) as Json,
        how_to_use: (row.how_to_use ?? {}) as Json,
        warnings: (row.warnings ?? {}) as Json,
        /*
         * Cast through the enum the column actually is. Read back as `unknown` it widens to `string`,
         * which the generated types rightly refuse — the value came out of this same column, so the
         * narrowing is a restatement of a fact rather than an assumption.
         */
        form: (row.form ?? null) as Database['public']['Enums']['product_form'] | null,
        serving_size: (row.serving_size ?? null) as string | null,
        dietary_tags: (row.dietary_tags ?? []) as string[],
        seo: (row.seo ?? {}) as Json,
        status: 'draft',
      })
      .select('id')
      .single();

    if (error || !created) {
      logger.error('duplicateProduct failed', { cause: error?.message });
      return catalogFail(mapCatalogError(error?.message ?? ''));
    }
    const newId = (created as { id: string }).id;

    /*
     * The join tables, copied by reading and re-inserting rather than by an `insert … select`, because
     * PostgREST has no way to express the latter. Each is best-effort: a duplicate with its categories
     * but not its certifications is still far more useful than a failure, and the editor shows exactly
     * what is missing.
     */
    const copyLinks = async (
      table: 'product_categories' | 'product_health_goals' | 'product_certifications',
      select: string,
      map: (source: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const { data: rows } = await supabase.from(table).select(select).eq('product_id', productId);
      const payload = ((rows ?? []) as unknown as Record<string, unknown>[]).map(map);
      if (payload.length > 0) await supabase.from(table).insert(payload as never);
    };

    await copyLinks('product_categories', 'category_id, is_primary', (link) => ({
      product_id: newId,
      category_id: link.category_id,
      is_primary: link.is_primary,
    }));
    await copyLinks('product_health_goals', 'goal_id', (link) => ({
      product_id: newId,
      goal_id: link.goal_id,
    }));
    await copyLinks('product_certifications', 'certification_id', (link) => ({
      product_id: newId,
      certification_id: link.certification_id,
    }));

    const { data: label } = await supabase
      .from('product_ingredients')
      .select('ingredient_id, amount, unit, nrv_pct, per_serving, position')
      .eq('product_id', productId);
    const labelRows = ((label ?? []) as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      product_id: newId,
    }));
    if (labelRows.length > 0) await supabase.from('product_ingredients').insert(labelRows as never);

    await audit('product.duplicated', 'product', newId, { from: productId }, {
      slug,
      links: {
        label: labelRows.length,
      },
    } as unknown as Json);

    revalidatePath('/admin/products');
    /*
     * Straight into the copy's editor. The operator's next action is certain — a SKU and a price, which
     * the duplicate deliberately did not invent — so landing them on the list to find it themselves is a
     * step with no decision in it.
     */
    redirect(`/admin/products/${newId}`);
  } catch (error) {
    /*
     * `redirect` throws by design in Next, so it must not be swallowed here. Anything else is a genuine
     * fault: `NEXT_REDIRECT` is how the framework unwinds, and catching it would turn a successful
     * duplicate into a generic error.
     */
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'digest' in error &&
      String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    logger.error('duplicateProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

export interface BulkRemoveReport {
  requested: number;
  removed: number;
  /** Rows the rules refused, with the reason, so a partial result explains itself. */
  skipped: { id: string; label: string; reason: string }[];
}

export type BulkRemoveState = ActionResult<BulkRemoveReport, CatalogErrorKey> | null;

/**
 * Removes several products at once, or puts several back.
 *
 * ── One statement, and the same guard as the single path ──
 *
 * The write is a single `UPDATE … .in('id', ids).neq('status','published').is('deleted_at', null)`, so it
 * is atomic and its `RETURNING` list is the report: whatever came back was removed, whatever was asked for
 * and did not is explained from the pre-read. The published guard is enforced *in the statement* rather
 * than by filtering the list first — a product published between the click and the write must not slip
 * through, and a stale tab is the ordinary case on a list somebody left open.
 *
 * ── Why removal in bulk is safe where a decision would not be ──
 *
 * No email, no storage copy, no per-row cache purge: one tag purge covers the catalogue. So the cost is
 * a single UPDATE regardless of the count, and the cap exists to make "select all" a considered act
 * rather than to protect a request budget.
 */
export async function removeProductsBulk(
  _previous: BulkRemoveState,
  formData: FormData,
): Promise<BulkRemoveState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return fail<CatalogErrorKey, BulkRemoveReport>(gate.error);

  // `getAll`, never `Object.fromEntries` — a repeated checkbox collapses to its last value.
  const ids = [...new Set(formData.getAll('productIds').map((value) => String(value)))].filter(
    (id) => id.length > 0,
  );
  const parsed = productBulkSchema.safeParse({ productIds: ids });
  if (!parsed.success) {
    return fail<CatalogErrorKey, BulkRemoveReport>('admin.catalog.errors.checkFields');
  }

  try {
    const supabase = await createClient();

    const { data: beforeRows, error: readError } = await supabase
      .from('products')
      .select('id, slug, name, status, deleted_at')
      .in('id', parsed.data.productIds);

    if (readError) {
      logger.error('removeProductsBulk pre-read failed', { cause: readError.message });
      return fail<CatalogErrorKey, BulkRemoveReport>('admin.errors.generic');
    }

    interface Row {
      id: string;
      slug: string;
      name: unknown;
      status: string;
      deleted_at: string | null;
    }
    const before = new Map(((beforeRows ?? []) as unknown as Row[]).map((row) => [row.id, row]));

    const { data: updated, error: writeError } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', parsed.data.productIds)
      .neq('status', 'published')
      .is('deleted_at', null)
      .select('id, slug');

    if (writeError) {
      logger.error('removeProductsBulk write failed', { cause: writeError.message });
      return fail<CatalogErrorKey, BulkRemoveReport>('admin.errors.generic');
    }

    const done = ((updated ?? []) as { id: string; slug: string }[]).map((row) => row.id);
    const doneSet = new Set(done);

    const labelOf = (row: Row | undefined, id: string): string => {
      const pair = (row?.name ?? {}) as Record<string, string>;
      return pair.en || pair.sq || row?.slug || id.slice(0, 8);
    };

    const skipped = parsed.data.productIds
      .filter((id) => !doneSet.has(id))
      .map((id) => {
        const row = before.get(id);
        if (!row) return { id, label: id.slice(0, 8), reason: 'No longer in the catalogue.' };
        if (row.deleted_at !== null) {
          return { id, label: labelOf(row, id), reason: 'Already removed.' };
        }
        if (row.status === 'published') {
          return {
            id,
            label: labelOf(row, id),
            reason: 'Live on the site — archive it first, then it can be removed.',
          };
        }
        return { id, label: labelOf(row, id), reason: 'Changed since this page loaded.' };
      });

    /*
     * One audit row per product, with the singular action name, so "every decision about this product"
     * stays one query on `entity_id`. The shared `bulk_id` is what reconstructs the whole operation.
     */
    const bulkId = crypto.randomUUID();
    await auditMany(
      'product.removed',
      'product',
      done.map((id) => {
        const row = before.get(id);
        return {
          entityId: id,
          before: { status: row?.status ?? null },
          after: { slug: row?.slug ?? null, bulk: true, bulk_id: bulkId } as unknown as Json,
        };
      }),
    );

    /*
     * One coarse purge rather than a tag per product. A removal changes the listing, the categories and
     * the brands regardless of which products went, so the per-slug tags add round trips without adding
     * correctness — the opposite trade-off from the single path, where the product page itself is the
     * thing most likely to be looked at next.
     */
    if (done.length > 0) {
      revalidatePublic([
        CACHE_TAGS.products,
        CACHE_TAGS.categories,
        CACHE_TAGS.brands,
        CACHE_TAGS.goals,
      ]);
      revalidatePath('/admin/products');
    }

    return ok<BulkRemoveReport>({
      requested: parsed.data.productIds.length,
      removed: done.length,
      skipped,
    });
  } catch (error) {
    logger.error('removeProductsBulk threw', describeError(error));
    return fail<CatalogErrorKey, BulkRemoveReport>('admin.errors.generic');
  }
}

/** Puts several removed products back, at whatever status each held. */
export async function restoreProductsBulk(
  _previous: BulkRemoveState,
  formData: FormData,
): Promise<BulkRemoveState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return fail<CatalogErrorKey, BulkRemoveReport>(gate.error);

  const ids = [...new Set(formData.getAll('productIds').map((value) => String(value)))].filter(
    (id) => id.length > 0,
  );
  const parsed = productBulkSchema.safeParse({ productIds: ids });
  if (!parsed.success) {
    return fail<CatalogErrorKey, BulkRemoveReport>('admin.catalog.errors.checkFields');
  }

  try {
    const supabase = await createClient();

    const { data: updated, error } = await supabase
      .from('products')
      .update({ deleted_at: null })
      .in('id', parsed.data.productIds)
      .not('deleted_at', 'is', null)
      .select('id');

    if (error) {
      logger.error('restoreProductsBulk failed', { cause: error.message });
      return fail<CatalogErrorKey, BulkRemoveReport>('admin.errors.generic');
    }

    const done = ((updated ?? []) as { id: string }[]).map((row) => row.id);
    const bulkId = crypto.randomUUID();
    await auditMany(
      'product.restored',
      'product',
      done.map((id) => ({ entityId: id, after: { bulk: true, bulk_id: bulkId } as unknown as Json })),
    );

    if (done.length > 0) {
      revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.categories, CACHE_TAGS.brands]);
      revalidatePath('/admin/products');
    }

    return ok<BulkRemoveReport>({
      requested: parsed.data.productIds.length,
      removed: done.length,
      // A row that was not removed in the first place is already in the state the caller wanted.
      skipped: [],
    });
  } catch (error) {
    logger.error('restoreProductsBulk threw', describeError(error));
    return fail<CatalogErrorKey, BulkRemoveReport>('admin.errors.generic');
  }
}

/** docs/06 §3.2 — create or update one variant. */
export async function saveVariant(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const raw = Object.fromEntries(formData);
  const parsed = variantSchema.safeParse({
    ...raw,
    name: { sq: raw['name.sq'], en: raw['name.en'] },
  });

  if (!parsed.success) {
    return fromFieldErrors<CatalogErrorKey, { id?: string }>('admin.catalog.errors.checkFields', {
      fieldErrors: fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES),
    });
  }
  const input = parsed.data;

  /*
   * Prices are parsed outside Zod, so their failures have to be attributed by hand — and separately.
   *
   * Both used to collapse into one `invalidPrice` alert that named neither field: with a good price and
   * a mistyped compare-at, the editor was told "Enter a price like 9.90" while the price box was
   * already correct. `toCents` throws rather than returning null, so each is tried on its own.
   */
  const priceErrors: Record<string, string[]> = {};

  let priceCents = 0;
  try {
    priceCents = toCents(input.price);
    if (priceCents <= 0) priceErrors.price = ['Must be more than zero.'];
  } catch {
    priceErrors.price = ['Enter an amount like 9.90.'];
  }

  let compareAtCents: number | null = null;
  if (input.compareAtPrice) {
    try {
      compareAtCents = toCents(input.compareAtPrice);
    } catch {
      priceErrors.compareAtPrice = ['Enter an amount like 12.90, or leave it empty.'];
    }
  }

  /*
   * A compare-at at or below the price is not a formatting mistake, it is a wrong discount: it would
   * render a struck-through "was" that is cheaper than the price, and a negative percentage on the
   * card. Checked here because it is the only place both numbers exist — the Zod schema sees two
   * unparsed strings.
   */
  if (compareAtCents !== null && priceCents > 0 && compareAtCents <= priceCents) {
    priceErrors.compareAtPrice = ['Must be higher than the price, or empty.'];
  }

  if (Object.keys(priceErrors).length > 0) {
    return fromFieldErrors<CatalogErrorKey, { id?: string }>('admin.catalog.errors.checkFields', {
      fieldErrors: priceErrors,
    });
  }

  try {
    const supabase = await createClient();

    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', input.productId)
      .maybeSingle();
    if (!product) return catalogFail('admin.catalog.errors.notFound');

    /*
     * `one_default_variant` is a partial unique index, so promoting a variant while another is
     * still default fails. Clearing first makes "make this the default" a single operator
     * action rather than "unset that one, then set this one".
     */
    if (input.isDefault) {
      await supabase
        .from('product_variants')
        .update({ is_default: false })
        .eq('product_id', input.productId);
    }

    const values = {
      product_id: input.productId,
      sku: input.sku,
      name: input.name.en ? { sq: input.name.sq, en: input.name.en } : { sq: input.name.sq },
      price_cents: priceCents,
      compare_at_price_cents: compareAtCents,
      is_active: input.isActive,
      is_default: input.isDefault,
    };

    const { error } = input.variantId
      ? await supabase.from('product_variants').update(values).eq('id', input.variantId)
      : await supabase.from('product_variants').insert(values);

    if (error) {
      logger.info('Variant save rejected', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    await audit(
      input.variantId ? 'variant.updated' : 'variant.created',
      'product_variant',
      input.variantId || null,
      null,
      { sku: input.sku, priceCents, isActive: input.isActive, isDefault: input.isDefault },
    );

    revalidateProduct((product as { slug: string }).slug);
    revalidatePath(`/admin/products/${input.productId}`);
    return ok({ id: input.variantId || undefined });
  } catch (error) {
    logger.error('saveVariant threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * Deactivates a variant rather than deleting it.
 *
 * `order_items.variant_id` is `on delete set null`, so a hard delete would sever every past
 * order from what was actually sold — the snapshot name and SKU survive, but the link does not,
 * and that link is what a return or a restock needs. Deactivating removes it from the storefront
 * and from checkout, which is what the operator means.
 */
export async function deactivateVariant(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = deleteVariantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();

    const { data: product } = await supabase
      .from('products')
      .select('slug, status')
      .eq('id', parsed.data.productId)
      .maybeSingle();
    if (!product) return catalogFail('admin.catalog.errors.notFound');

    /*
     * A published product must keep at least one active variant — otherwise it stays listed with
     * nothing to buy. The publish guard cannot catch this: it fires on the transition *into*
     * published, not on a later edit that empties the product.
     */
    if ((product as { status: string }).status === 'published') {
      const { data: active } = await supabase
        .from('product_variants')
        .select('id')
        .eq('product_id', parsed.data.productId)
        .eq('is_active', true);

      if ((active ?? []).length <= 1) return catalogFail('admin.catalog.errors.lastVariant');
    }

    const { error } = await supabase
      .from('product_variants')
      .update({ is_active: false, is_default: false })
      .eq('id', parsed.data.variantId);

    if (error) return catalogFail(mapCatalogError(error.message));

    await audit('variant.deactivated', 'product_variant', parsed.data.variantId, null, null);

    revalidateProduct((product as { slug: string }).slug);
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('deactivateVariant threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/** docs/07 §10 — draft ↔ pending_review, and archiving. */
export async function setProductStatus(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('products')
      .select('slug, status')
      .eq('id', parsed.data.productId)
      .maybeSingle();
    if (!before) return catalogFail('admin.catalog.errors.notFound');
    const previous = before as { slug: string; status: string };

    const { error } = await supabase
      .from('products')
      .update({ status: parsed.data.to })
      .eq('id', parsed.data.productId);

    if (error) return catalogFail(mapCatalogError(error.message));

    await audit('product.status_changed', 'product', parsed.data.productId, previous, {
      status: parsed.data.to,
    });

    revalidateProduct(previous.slug);
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('setProductStatus threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * docs/06 §14 — compliance approves, and optionally publishes in the same write.
 *
 * `compliance.approve`, not `products.manage`: the whole point of the workflow is that the
 * person who wrote the claims is not the person who clears them.
 */
export async function approveProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = approveProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from('products')
      .select('slug, status, approved_by')
      .eq('id', parsed.data.productId)
      .maybeSingle();
    if (!before) return catalogFail('admin.catalog.errors.notFound');
    const previous = before as { slug: string; status: string; approved_by: string | null };

    /*
     * Approval and publication in one statement, because `guard_product_publish` reads
     * `new.approved_by` — approving first and publishing second would be two writes where the
     * first is meaningless on its own, and a failure between them leaves an approved draft
     * nobody asked for.
     */
    const { error } = await supabase
      .from('products')
      .update({
        approved_by: gate.actor.id,
        approved_at: new Date().toISOString(),
        ...(parsed.data.publish ? { status: 'published' as const } : {}),
      })
      .eq('id', parsed.data.productId);

    if (error) {
      logger.info('Approve rejected', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    await audit('product.approved', 'product', parsed.data.productId, previous, {
      approvedBy: gate.actor.id,
      published: parsed.data.publish,
    });

    revalidateProduct(previous.slug);
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('approveProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/** docs/06 §14 — reject with a note, sending it back to draft. */
export async function rejectProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('compliance.approve');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = rejectProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return catalogFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();

    /*
     * The approval stamp is cleared, not just the status.
     *
     * This used to write `{ status: 'draft' }` alone, leaving `approved_by` and `approved_at` set — so a
     * product compliance had just rejected still reported **Approved** in the editor, and
     * `publishBlockers` stopped listing approval, making the checklist read "Everything is in place." on
     * a product that had been sent back. The stamp is the record of a decision that has been withdrawn,
     * and `guard_product_publish` keys the whole publish gate on it.
     *
     * Rejecting is therefore the exact inverse of `approveProduct`, which sets both.
     */
    const { error } = await supabase
      .from('products')
      .update({ status: 'draft', approved_by: null, approved_at: null })
      .eq('id', parsed.data.productId);

    if (error) return catalogFail(mapCatalogError(error.message));

    /*
     * The note lives in the audit row and nowhere else, which is a v1 limitation worth naming:
     * docs/06 §14 wants the product manager notified. There is no in-app notification surface
     * yet, and `audit_logs` is admin-read-only, so a rejected product manager learns why by
     * being told. Tracked in docs/14 §2 under M6.
     */
    await audit('product.rejected', 'product', parsed.data.productId, null, {
      note: parsed.data.note,
      rejectedBy: gate.actor.id,
    });

    revalidatePath('/admin/products');
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('rejectProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * docs/06 §3.5 — the SEO tab.
 *
 * Stored as `products.seo` = `{ title: {sq, en}, description: {sq, en} }`, and read by the PDP's
 * `generateMetadata` in preference to the derived name and subtitle. Both halves shipped in the
 * same change deliberately: an override nothing reads is a field that silently does nothing, and
 * this milestone already produced one of those — `revalidatePublic` purging tags no read carried
 * (docs/13 §K1). A writer without a reader is the same defect wearing different clothes.
 *
 * Empty means "derive it". An override that must be filled in for every product is an override
 * nobody maintains, and a blank one is worse than a generated one.
 */
export async function saveProductSeo(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const parsed = productSeoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    /*
     * `fieldErrorsFrom` rather than `flatten()`, for the messages rather than the paths.
     *
     * This schema is flat, so `flatten()` did key the fields correctly — but it passed Zod's own
     * wording straight through, and an editor over the 60-character title limit was told "Too big:
     * expected string to have <=60 characters". The translation is the point here.
     */
    return withValues(
      fromFieldErrors<CatalogErrorKey, { id?: string }>('admin.catalog.errors.checkFields', {
        fieldErrors: fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES),
      }),
      Object.fromEntries(formData),
    );
  }

  const input = parsed.data;

  try {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from('products')
      .select('slug')
      .eq('id', input.productId)
      .maybeSingle();
    if (!existing) return catalogFail('admin.catalog.errors.notFound');

    // Absent keys rather than empty strings, so `pickLocale` falls back instead of returning ''.
    const localized = (sq?: string, en?: string) => {
      const out: Record<string, string> = {};
      if (sq) out.sq = sq;
      if (en) out.en = en;
      return out;
    };

    const { error } = await supabase
      .from('products')
      .update({
        seo: {
          title: localized(input.titleSq, input.titleEn),
          description: localized(input.descriptionSq, input.descriptionEn),
        },
      })
      .eq('id', input.productId);

    if (error) {
      logger.error('Save SEO failed', { cause: error.message });
      return catalogFail(mapCatalogError(error.message));
    }

    await audit('product.seo_updated', 'product', input.productId, null, null);

    revalidateProduct((existing as { slug: string }).slug);
    revalidatePath(`/admin/products/${input.productId}`);
    return ok({});
  } catch (error) {
    logger.error('saveProductSeo threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }
}

/**
 * Creates a draft and redirects into its editor.
 *
 * Only the three fields a product cannot exist without — slug, brand, Albanian name. Asking for
 * six tabs before anything is saved is how an editor loses twenty minutes of work to a
 * mistyped URL.
 */
export async function createProduct(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return catalogFail(gate.error);

  const submitted = Object.fromEntries(formData);
  const parsed = createProductSchema.safeParse(submitted);

  /*
   * Field errors, not just "check the fields marked below".
   *
   * The first version returned the bare key, so the form said "marked below" and marked
   * nothing — and because the inputs had no `defaultValue`, the operator also lost everything
   * they had typed. Two failures compounding: no idea what was wrong, and no way back to what
   * they wrote. Exactly the defect fixed in the order-lookup form in M4 (docs/13 §I6), repeated
   * here because the lesson lived in that file rather than in a shared habit.
   */
  if (!parsed.success) {
    return withValues(
      fromFieldErrors<CatalogErrorKey, { id?: string }>('admin.catalog.errors.checkFields', {
        fieldErrors: fieldErrorsFrom(parsed.error.issues, CATALOG_FIELD_MESSAGES),
      }),
      submitted,
    );
  }

  let newId: string;

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('products')
      .insert({
        slug: parsed.data.slug,
        brand_id: parsed.data.brandId,
        name: { sq: parsed.data.nameSq },
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) {
      logger.info('Product create rejected', { cause: error.message });
      // A taken slug is the likeliest failure here, and the one where losing the brand and
      // name the operator already chose is most annoying.
      return withValues(catalogFail(mapCatalogError(error.message)), submitted);
    }

    newId = (data as { id: string }).id;
    await audit('product.created', 'product', newId, null, { slug: parsed.data.slug });
    revalidatePath('/admin/products');
  } catch (error) {
    logger.error('createProduct threw', describeError(error));
    return catalogFail('admin.errors.generic');
  }

  // Outside the try: redirect() signals by throwing and must not be caught.
  redirect(`/admin/products/${newId}`);
}
