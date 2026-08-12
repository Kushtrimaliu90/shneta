'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/money';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok } from '@/lib/result';
import { fieldErrorsFrom } from '@/lib/field-errors';
import { audit, requireCapability } from '@/features/admin/audit';
import {
  approveProductSchema,
  CATALOG_FIELD_MESSAGES,
  createProductSchema,
  deleteVariantSchema,
  productGeneralSchema,
  productSeoSchema,
  productStatusSchema,
  rejectProductSchema,
  variantSchema,
} from '@/features/catalog/admin-schemas';

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
  | 'admin.catalog.errors.duplicateIngredient';

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

    const { error } = await supabase
      .from('products')
      .update({ status: 'draft' })
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
