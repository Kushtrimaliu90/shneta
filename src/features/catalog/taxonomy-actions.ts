'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { slugSchema } from '@/features/catalog/admin-schemas';
import { taxonomyAttachments } from '@/features/catalog/taxonomy-queries';
import { canPurge, canRemoveBrand, canRemoveCategory } from '@/features/catalog/removal';
import { FORM_LEVEL } from '@/lib/field-errors';
import type { Capability } from '@/features/admin/roles';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/06 §4–§7 — brands, categories, health goals and ingredients.
 *
 * One module for four entities because they are the same shape: a slug, a name, some bilingual
 * prose, an active flag, a sort order. Four near-identical files would drift — one would gain a
 * duplicate-slug message the others lack, one would forget to purge its tag.
 *
 * What differs per entity is captured in `ENTITIES` below: which table, which capability, which
 * cache tag. Everything else is shared, including the thing most often forgotten — every write
 * purges the tag its storefront pages read through, which only started working in docs/13 §K1.
 *
 * **Not built here:** the `seo` jsonb column each of these tables carries. Nothing on the
 * storefront reads it yet — page metadata is generated from the name and description — so an
 * editor for it would write a field with no reader. It belongs with the SEO work in docs/08 §4,
 * where the reader and the writer can be built together and tested against each other.
 */

export type TaxonomyErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.catalog.errors.checkFields'
  | 'admin.catalog.errors.slugTaken'
  | 'admin.catalog.errors.notFound'
  | 'admin.catalog.errors.inUse'
  | 'admin.catalog.errors.hasChildren'
  | 'admin.catalog.errors.categoryCycle'
  | 'admin.catalog.errors.uploadFailed'
  /** A removal the rules refuse; the reason, with its counts, arrives in `fieldErrors._form`. */
  | 'admin.catalog.errors.removeBlocked'
  /** Only brands and categories carry `deleted_at`; goals and ingredients are deactivated instead. */
  | 'admin.catalog.errors.notRemovable';

export type TaxonomyState =
  | { ok: true; data: { id?: string; path?: string; token?: string } }
  | {
      ok: false;
      error: TaxonomyErrorKey;
      fieldErrors?: Record<string, string[]>;
      values?: Record<string, string>;
    }
  | null;

export type TaxonomyKind = 'brand' | 'category' | 'goal' | 'ingredient';

type TaxonomyTable = 'brands' | 'categories' | 'health_goals' | 'ingredients';

interface EntityConfig {
  table: TaxonomyTable;
  capability: Capability;
  tag: string;
  adminPath: string;
}

const ENTITIES: Record<TaxonomyKind, EntityConfig> = {
  brand: {
    table: 'brands',
    capability: 'catalog.manage',
    tag: CACHE_TAGS.brands,
    adminPath: '/admin/brands',
  },
  category: {
    table: 'categories',
    capability: 'catalog.manage',
    tag: CACHE_TAGS.categories,
    adminPath: '/admin/categories',
  },
  goal: {
    table: 'health_goals',
    capability: 'content.manage',
    tag: CACHE_TAGS.goals,
    adminPath: '/admin/goals',
  },
  ingredient: {
    table: 'ingredients',
    capability: 'catalog.manage',
    tag: CACHE_TAGS.ingredients,
    adminPath: '/admin/ingredients',
  },
};

function taxFail(error: TaxonomyErrorKey): TaxonomyState {
  return fail<TaxonomyErrorKey, { id?: string; path?: string; token?: string }>(error);
}

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

/**
 * One schema for four entities.
 *
 * Every prose field is optional, and each table takes the subset it has a column for — the goal
 * editor sends `tagline`, the ingredient editor sends `summary`/`benefits`/`dosage`/`safety`,
 * and neither has to know about the other. A field that arrives for the wrong kind is simply
 * never read, which is the failure mode worth having: a spurious field is ignored, a missing one
 * is a visible blank.
 */
const baseSchema = z.object({
  kind: z.enum(['brand', 'category', 'goal', 'ingredient']),
  /** Absent when creating. */
  id: z.union([z.string().uuid(), z.literal('')]).optional(),
  slug: slugSchema,
  nameSq: z.string().trim().min(1, 'REQUIRED').max(160),
  nameEn: optionalText(160),
  descriptionSq: optionalText(4000),
  descriptionEn: optionalText(4000),
  taglineSq: optionalText(200),
  taglineEn: optionalText(200),
  summarySq: optionalText(4000),
  summaryEn: optionalText(4000),
  benefitsSq: optionalText(4000),
  benefitsEn: optionalText(4000),
  dosageSq: optionalText(4000),
  dosageEn: optionalText(4000),
  safetySq: optionalText(4000),
  safetyEn: optionalText(4000),
  /*
   * An unticked checkbox is not submitted at all, so an absent value means "unchecked" — not
   * "unspecified". `.default(true)` here would make the box impossible to untick from the
   * editor: every save would silently re-activate the row, and the only way to hide anything
   * would be the separate Hide button.
   */
  isActive: z
    .union([z.literal('true'), z.literal('')])
    .optional()
    .transform((value) => value === 'true'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  icon: optionalText(60),
  /** Categories only. */
  parentId: z.union([z.string().uuid(), z.literal('')]).optional(),
  /** Brands only. */
  countryCode: z.union([z.string().trim().length(2, 'COUNTRY_CODE'), z.literal('')]).optional(),
  websiteUrl: z.union([z.string().trim().url('INVALID_URL').max(300), z.literal('')]).optional(),
  /** Ingredients only. */
  evidence: z.enum(['strong', 'moderate', 'emerging', 'traditional']).optional().or(z.literal('')),
  ingredientCategory: optionalText(60),
  otherNames: optionalText(400),
});

type TaxonomyInput = z.infer<typeof baseSchema>;

function withValues(state: TaxonomyState, submitted: Record<string, FormDataEntryValue>) {
  if (!state || state.ok) return state;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(submitted)) {
    if (typeof value === 'string') values[key] = value.slice(0, 4000);
  }
  return { ...state, values };
}

/**
 * A bilingual jsonb value.
 *
 * An absent `en` key rather than an empty string, because `pickLocale` falls back on absence and
 * would otherwise hand an English reader a confident empty string where Albanian text exists.
 */
function bilingual(sq?: string, en?: string) {
  const out: Record<string, string> = {};
  if (sq) out.sq = sq;
  if (en) out.en = en;
  return out;
}

/**
 * `other_names` is a text[] — the synonyms an ingredient is searched by ("cholecalciferol" for
 * vitamin D3). Entered as one comma-separated line, which is how an editor thinks of them.
 */
function parseList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * Would setting `parentId` as the parent of `id` create a loop?
 *
 * Worth a query because the consequence is invisible rather than loud: `getCategoryTree` builds
 * the tree by attaching each node to its parent and treating the parentless as roots, so a cycle
 * attaches every category in the loop to another member of it and none of them to a root. The
 * categories do not error — they simply stop appearing in the navigation.
 */
async function wouldCycle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  parentId: string,
): Promise<boolean> {
  if (id === parentId) return true;

  const { data } = await supabase.from('categories').select('id, parent_id');
  const parents = new Map((data ?? []).map((row) => [row.id, row.parent_id]));

  let cursor: string | null | undefined = parentId;
  // Bounded by the row count: a malformed table that already contains a cycle must not hang.
  for (let step = 0; cursor && step <= parents.size; step += 1) {
    if (cursor === id) return true;
    cursor = parents.get(cursor) ?? null;
  }
  return false;
}

/**
 * Builds the column values for one table.
 *
 * Written **per table**, not as one wide record. A `Record<string, unknown>` shared across four
 * tables compiles, and the generated types refuse it — correctly. Their objection is the exact
 * bug that already cost an afternoon in this milestone: ordering categories by `position` when
 * the column is `sort_order`, which failed silently at runtime. Four short branches buy
 * compile-time proof that every column exists on the table being written.
 *
 * The verbosity is the point. `as never` here would restore precisely the hole the types close.
 */
async function writeRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: TaxonomyTable,
  input: TaxonomyInput,
) {
  const id = input.id || null;

  switch (table) {
    case 'brands': {
      const values = {
        slug: input.slug,
        // A proper noun: "Solgar" is "Solgar" in both languages, and offering a translation
        // would produce two spellings of a trademark.
        name: input.nameSq,
        description: bilingual(input.descriptionSq, input.descriptionEn),
        country_code: input.countryCode ? input.countryCode.toUpperCase() : null,
        website_url: input.websiteUrl || null,
        is_active: input.isActive,
        sort_order: input.sortOrder,
      };
      return id
        ? supabase.from('brands').update(values).eq('id', id).select('id').single()
        : supabase.from('brands').insert(values).select('id').single();
    }
    case 'categories': {
      const values = {
        slug: input.slug,
        name: bilingual(input.nameSq, input.nameEn),
        description: bilingual(input.descriptionSq, input.descriptionEn),
        parent_id: input.parentId || null,
        icon: input.icon || null,
        is_active: input.isActive,
        sort_order: input.sortOrder,
      };
      return id
        ? supabase.from('categories').update(values).eq('id', id).select('id').single()
        : supabase.from('categories').insert(values).select('id').single();
    }
    case 'health_goals': {
      const values = {
        slug: input.slug,
        name: bilingual(input.nameSq, input.nameEn),
        tagline: bilingual(input.taglineSq, input.taglineEn),
        description: bilingual(input.descriptionSq, input.descriptionEn),
        icon: input.icon || null,
        is_active: input.isActive,
        sort_order: input.sortOrder,
      };
      return id
        ? supabase.from('health_goals').update(values).eq('id', id).select('id').single()
        : supabase.from('health_goals').insert(values).select('id').single();
    }
    case 'ingredients': {
      // No `sort_order` — the A–Z list orders by slug (docs/05 §6).
      const values = {
        slug: input.slug,
        name: bilingual(input.nameSq, input.nameEn),
        summary: bilingual(input.summarySq, input.summaryEn),
        benefits: bilingual(input.benefitsSq, input.benefitsEn),
        dosage_notes: bilingual(input.dosageSq, input.dosageEn),
        safety_notes: bilingual(input.safetySq, input.safetyEn),
        evidence: input.evidence || null,
        category: input.ingredientCategory || null,
        other_names: parseList(input.otherNames),
        is_active: input.isActive,
      };
      return id
        ? supabase.from('ingredients').update(values).eq('id', id).select('id').single()
        : supabase.from('ingredients').insert(values).select('id').single();
    }
  }
}

/**
 * Creates or updates one taxonomy row.
 *
 * `sort_order` rather than the drag-and-drop reordering docs/06 §4 asks for. A number field is
 * not as nice, but it works without JavaScript, is unambiguous over a hierarchy, and gets the
 * catalogue enterable now — the drag interaction can replace it later without touching the data.
 */
export async function saveTaxonomy(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const submitted = Object.fromEntries(formData);
  const parsed = baseSchema.safeParse(submitted);

  if (!parsed.success) {
    return withValues(
      fromFieldErrors<TaxonomyErrorKey, { id?: string; path?: string; token?: string }>(
        'admin.catalog.errors.checkFields',
        parsed.error.flatten(),
      ),
      submitted,
    );
  }

  const input = parsed.data;
  const entity = ENTITIES[input.kind];

  const gate = await requireCapability(entity.capability);
  if (!gate.ok) return taxFail(gate.error);

  try {
    const supabase = await createClient();

    if (input.kind === 'category' && input.id && input.parentId) {
      if (await wouldCycle(supabase, input.id, input.parentId)) {
        return withValues(taxFail('admin.catalog.errors.categoryCycle'), submitted);
      }
    }

    const { data, error } = await writeRow(supabase, entity.table, input);

    if (error) {
      logger.info('Taxonomy save rejected', { kind: input.kind, cause: error.message });
      const key: TaxonomyErrorKey = error.message.includes('duplicate key')
        ? 'admin.catalog.errors.slugTaken'
        : 'admin.errors.generic';
      return withValues(taxFail(key), submitted);
    }

    const id = (data as { id: string }).id;
    await audit(`${input.kind}.${input.id ? 'updated' : 'created'}`, input.kind, id, null, {
      slug: input.slug,
    });

    // Product cards carry brand and category names, so a rename has to reach the listings too.
    revalidatePublic([entity.tag, CACHE_TAGS.products]);
    revalidatePath(entity.adminPath);

    return ok({ id });
  } catch (error) {
    logger.error('saveTaxonomy threw', describeError(error));
    return taxFail('admin.errors.generic');
  }
}

const toggleSchema = z.object({
  kind: z.enum(['brand', 'category', 'goal', 'ingredient']),
  id: z.string().uuid(),
  isActive: z.coerce.boolean(),
});

/**
 * Removing or restoring a brand or a category.
 *
 * `goal` and `ingredient` are absent from the enum rather than rejected in the body: `health_goals` and
 * `ingredients` have no `deleted_at` column, so removal is not a state they can be in. Deactivating is
 * the whole vocabulary there, and the schema is where that belongs — the alternative is an action that
 * accepts a request it can never satisfy.
 */
const removeSchema = z.object({
  kind: z.enum(['brand', 'category']),
  id: z.string().uuid(),
});

/**
 * Removes a brand or a category from the panel, reversibly.
 *
 * Sets `deleted_at`, which is all it takes to remove it from the shop as well — `p_read` on both tables
 * is `(is_active and deleted_at is null)`, so the public site drops it at the database.
 *
 * The guards are the interesting part, and both come from the foreign keys rather than from taste:
 *
 *   **A brand still used by a product is refused.** `products.brand_id` is `not null references
 *   brands(id)` with no on-delete rule. A hard delete would be refused by Postgres; a soft delete is
 *   worse, because the product keeps pointing at a row no query returns and its page renders a blank
 *   brand instead of failing visibly.
 *
 *   **A category with sub-categories or products is refused.** `parent_id` is `on delete set null`, so
 *   removing a parent silently promotes its children to the top level of the navigation — the same trap
 *   `toggleTaxonomyActive` already documents for deactivation. And `p_read on product_categories` is
 *   `using (true)`, so a product's breadcrumb could name a removed category.
 *
 * Both offer deactivation instead, because that is the thing the operator almost always meant.
 */
export async function removeTaxonomy(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // A goal or an ingredient reaching here is a wrong control, not a malformed one.
    const kind = String(formData.get('kind') ?? '');
    if (kind === 'goal' || kind === 'ingredient') {
      return taxFail('admin.catalog.errors.notRemovable');
    }
    return taxFail('admin.catalog.errors.checkFields');
  }

  const { kind, id } = parsed.data;
  const entity = ENTITIES[kind];
  const gate = await requireCapability(entity.capability);
  if (!gate.ok) return taxFail(gate.error);

  /*
   * The table as a narrow literal, not `entity.table`.
   *
   * `EntityConfig.table` is the union of all four taxonomy tables, and `health_goals` and `ingredients`
   * genuinely have no `deleted_at` — so a select naming that column against the union does not
   * typecheck, which is TypeScript enforcing exactly what `removeSchema` says. Deriving the literal from
   * `kind` narrows it to the two that do.
   */
  const table = kind === 'brand' ? ('brands' as const) : ('categories' as const);


  const blocked = (verdict: { reason: string; instead?: string }): TaxonomyState => ({
    ok: false,
    error: 'admin.catalog.errors.removeBlocked',
    fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) },
  });

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from(table)
      .select('slug, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (!before) return taxFail('admin.catalog.errors.notFound');
    const row = before as { slug: string; deleted_at: string | null };
    // Already removed: a double-submit, not something to alarm anyone about.
    if (row.deleted_at !== null) return { ok: true, data: { id } };

    if (kind === 'brand') {
      /*
       * Counting products that are not themselves removed. A brand whose only products are in the bin
       * is genuinely unused, and refusing on their account would make the two features fight.
       */
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', id)
        .is('deleted_at', null);

      const verdict = canRemoveBrand(count ?? 0);
      if (!verdict.allowed) return blocked(verdict);
    } else {
      const [{ count: children }, { count: products }] = await Promise.all([
        supabase
          .from('categories')
          .select('id', { count: 'exact', head: true })
          .eq('parent_id', id)
          .is('deleted_at', null),
        supabase
          .from('product_categories')
          .select('product_id, products!inner(deleted_at)', { count: 'exact', head: true })
          .eq('category_id', id)
          .is('products.deleted_at', null),
      ]);

      const verdict = canRemoveCategory(children ?? 0, products ?? 0);
      if (!verdict.allowed) return blocked(verdict);
    }

    const { error } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      // So a stale tab cannot remove something already removed and write a second timestamp over it.
      .is('deleted_at', null);

    if (error) {
      logger.error('removeTaxonomy failed', { kind, cause: error.message });
      return taxFail('admin.errors.generic');
    }

    await audit(`${kind}.removed`, entity.table, id, null, { slug: row.slug } as unknown as Json);

    revalidatePublic([entity.tag, CACHE_TAGS.products]);
    revalidatePath(entity.adminPath);
    return { ok: true, data: { id } };
  } catch (error) {
    logger.error('removeTaxonomy threw', { kind, ...describeError(error) });
    return taxFail('admin.errors.generic');
  }
}

/**
 * Puts a removed brand or category back.
 *
 * It returns with its previous `is_active` intact, so a brand that was switched off before being removed
 * comes back switched off — restoring is not a way to publish something by accident. The slug is still
 * its own, because a removed row keeps its `unique` claim on it.
 */
export async function restoreTaxonomy(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return taxFail('admin.catalog.errors.checkFields');

  const { kind, id } = parsed.data;
  const entity = ENTITIES[kind];
  const gate = await requireCapability(entity.capability);
  if (!gate.ok) return taxFail(gate.error);

  /*
   * The table as a narrow literal, not `entity.table`.
   *
   * `EntityConfig.table` is the union of all four taxonomy tables, and `health_goals` and `ingredients`
   * genuinely have no `deleted_at` — so a select naming that column against the union does not
   * typecheck, which is TypeScript enforcing exactly what `removeSchema` says. Deriving the literal from
   * `kind` narrows it to the two that do.
   */
  const table = kind === 'brand' ? ('brands' as const) : ('categories' as const);


  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from(table)
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('slug')
      .maybeSingle();

    if (error) {
      logger.error('restoreTaxonomy failed', { kind, cause: error.message });
      return taxFail('admin.errors.generic');
    }
    if (!data) return { ok: true, data: { id } };

    await audit(`${kind}.restored`, entity.table, id, null, {
      slug: (data as { slug: string }).slug,
    } as unknown as Json);

    revalidatePublic([entity.tag, CACHE_TAGS.products]);
    revalidatePath(entity.adminPath);
    return { ok: true, data: { id } };
  } catch (error) {
    logger.error('restoreTaxonomy threw', { kind, ...describeError(error) });
    return taxFail('admin.errors.generic');
  }
}

/**
 * Deactivates or reactivates a taxonomy row.
 *
 * Never deletes. docs/06 §4 blocks deactivating a category that still has published products and
 * §6 blocks deleting a referenced ingredient — both because the storefront would be left with a
 * product whose breadcrumb or label points at nothing. Deactivation is reversible and hides the
 * row from customers, which is what the operator means either way.
 */
export async function toggleTaxonomyActive(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return taxFail('admin.catalog.errors.checkFields');

  const { kind, id, isActive } = parsed.data;
  const entity = ENTITIES[kind];
  const gate = await requireCapability(entity.capability);
  if (!gate.ok) return taxFail(gate.error);

  try {
    const supabase = await createClient();

    if (!isActive && kind === 'category') {
      /*
       * docs/06 §4 — a category with published products cannot be switched off, because those
       * products keep a breadcrumb and a canonical pointing at a page that no longer lists them.
       *
       * Checked here rather than in the database: it is a workflow rule about what an operator
       * may do next, not an invariant the data must always satisfy. An inactive category with
       * products is a perfectly valid state to arrive at — by unpublishing the products first.
       */
      const { count } = await supabase
        .from('product_categories')
        .select('product_id, products!inner(status)', { count: 'exact', head: true })
        .eq('category_id', id)
        .eq('products.status', 'published');

      if ((count ?? 0) > 0) return taxFail('admin.catalog.errors.inUse');

      /*
       * And not while it has visible children.
       *
       * Hiding a parent does not hide its sub-categories: RLS removes the parent row from the
       * anonymous read, and `getCategoryTree` attaches every node whose parent it cannot see to
       * the **root**. So switching off "Vitamins" quietly promotes "Vitamin D" and "Vitamin C" to
       * the top level of the navigation. Nothing errors, nothing 404s, and the menu is wrong.
       */
      const { count: childCount } = await supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', id)
        .eq('is_active', true)
        .is('deleted_at', null);

      if ((childCount ?? 0) > 0) return taxFail('admin.catalog.errors.hasChildren');
    }

    const { error } = await supabase
      .from(entity.table)
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) {
      logger.error('Taxonomy toggle failed', { kind, cause: error.message });
      return taxFail('admin.errors.generic');
    }

    await audit(`${kind}.${isActive ? 'activated' : 'deactivated'}`, kind, id, null, null);

    revalidatePublic([entity.tag, CACHE_TAGS.products]);
    revalidatePath(entity.adminPath);
    return ok({});
  } catch (error) {
    logger.error('toggleTaxonomyActive threw', describeError(error));
    return taxFail('admin.errors.generic');
  }
}

/*
 * -----------------------------------------------------------------------------------------
 * Brand logos
 *
 * The same browser-direct upload as product media (`media-actions.ts`), against the
 * `brand-assets` bucket that migration 12 already created and restricted to `product_manager`.
 * The comment there explains why the bytes do not travel through the Node process; the reasoning
 * is identical and is not repeated.
 *
 * Brands, categories and health goals. The note here used to say categories and goals were excluded
 * because "no storefront component renders them yet — an uploader for a picture nobody displays is a
 * feature with no observable effect, and it can be built alongside the component that needs it." The
 * homepage category row (docs/13 §AJ) and the goals index now render them, so the condition is met and
 * the same flow covers all three. One bucket, because these are all taxonomy artwork with the same
 * `product_manager` restriction.
 * -----------------------------------------------------------------------------------------
 */

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = [
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/avif',
] as const;

/**
 * Which table and column each kind writes, and which cache tag it purges.
 *
 * Brands keep `logo_path` and everything else uses `image_path`; the difference is historical rather
 * than meaningful, and mapping it here is cheaper than a migration that renames a column three features
 * depend on.
 */
const IMAGE_TARGET = {
  brands: { table: 'brands', column: 'logo_path', tag: CACHE_TAGS.brands, admin: '/admin/brands' },
  categories: {
    table: 'categories',
    column: 'image_path',
    tag: CACHE_TAGS.categories,
    admin: '/admin/categories',
  },
  health_goals: {
    table: 'health_goals',
    column: 'image_path',
    tag: CACHE_TAGS.goals,
    admin: '/admin/goals',
  },
} as const;

type ImageKind = keyof typeof IMAGE_TARGET;

const logoSignSchema = z.object({
  kind: z.enum(['brands', 'categories', 'health_goals']),
  brandId: z.string().uuid(),
  contentType: z.enum(LOGO_TYPES),
  size: z.coerce.number().int().positive().max(LOGO_MAX_BYTES),
});

/** Mints a one-shot upload URL for a brand logo, at `{brandId}/{uuid}.{ext}`. */
export async function createBrandLogoUploadUrl(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const gate = await requireCapability('catalog.manage');
  if (!gate.ok) return taxFail(gate.error);

  const parsed = logoSignSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return taxFail('admin.catalog.errors.checkFields');

  const extension =
    {
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
    }[parsed.data.contentType] ?? 'bin';

  try {
    const supabase = await createClient();
    const path = `${parsed.data.brandId}/${randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from('brand-assets').createSignedUploadUrl(path);

    if (error || !data) {
      logger.error('Brand logo signed URL failed', { cause: error?.message });
      return taxFail('admin.catalog.errors.uploadFailed');
    }

    return ok({ path: data.path, token: data.token });
  } catch (error) {
    logger.error('createBrandLogoUploadUrl threw', describeError(error));
    return taxFail('admin.errors.generic');
  }
}

const logoAttachSchema = z.object({
  kind: z.enum(['brands', 'categories', 'health_goals']),
  brandId: z.string().uuid(),
  path: z.string().trim().min(3).max(300),
});

/** Records an uploaded object as the brand's logo, replacing whatever was there. */
export async function attachBrandLogo(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const gate = await requireCapability('catalog.manage');
  if (!gate.ok) return taxFail(gate.error);

  const parsed = logoAttachSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return taxFail('admin.catalog.errors.checkFields');

  // The path arrives from the browser, so it is checked against the prefix the signing action
  // always builds — otherwise a product manager could point one brand at another's object.
  if (!parsed.data.path.startsWith(`${parsed.data.brandId}/`)) {
    logger.info('Rejected logo path outside the brand prefix', { path: parsed.data.path });
    return taxFail('admin.catalog.errors.checkFields');
  }

  try {
    const supabase = await createClient();

    const target = IMAGE_TARGET[parsed.data.kind as ImageKind];

    const { data: previous } = await supabase
      .from(target.table)
      .select(target.column)
      .eq('id', parsed.data.brandId)
      .maybeSingle();

    /*
     * Cast at the write, because the column name is chosen at runtime.
     *
     * The generated types describe each table's update shape separately, so a computed key cannot match
     * all three at once. The value is still constrained: `kind` is a Zod enum and `IMAGE_TARGET` is the
     * only source of table and column, so nothing user-supplied reaches either.
     */
    const { error } = await supabase
      .from(target.table)
      .update({ [target.column]: parsed.data.path } as never)
      .eq('id', parsed.data.brandId);

    if (error) {
      logger.error('Attach brand logo failed', { cause: error.message });
      return taxFail('admin.errors.generic');
    }

    // The row first, then the bytes — a failed cleanup leaves an unreachable object, whereas
    // deleting first and failing on the row would leave a broken image on a live brand page.
    const stale = (previous as Record<string, string | null> | null)?.[target.column] ?? null;
    if (stale && stale !== parsed.data.path) {
      const { error: removeError } = await supabase.storage.from('brand-assets').remove([stale]);
      if (removeError) {
        logger.error('Orphaned brand logo after replace', {
          path: stale,
          cause: removeError.message,
        });
      }
    }

    await audit(`${parsed.data.kind}.image_changed`, parsed.data.kind, parsed.data.brandId, null, {
      path: parsed.data.path,
    });

    revalidatePublic([target.tag, CACHE_TAGS.products]);
    revalidatePath(target.admin);
    // The homepage carries the category row, so a new category picture must reach it immediately.
    revalidatePath('/', 'page');
    revalidatePath('/en', 'page');
    return ok({ path: parsed.data.path });
  } catch (error) {
    logger.error('attachBrandLogo threw', describeError(error));
    return taxFail('admin.errors.generic');
  }
}

/**
 * Destroys a removed brand or category for good.
 *
 * The second step, only from the bin, and only when nothing points at it. What it adds over removal is
 * that the slug becomes reusable — nothing else, since a removed row is already gone from the shop and
 * from the list.
 *
 * The attachment count deliberately ignores whether the *attached* rows are themselves removed: a removed
 * product still carries its `brand_id`, so destroying the brand would leave it pointing at nothing if it
 * were ever restored. Same for a removed child category.
 */
export async function purgeTaxonomy(
  _previous: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return taxFail('admin.catalog.errors.checkFields');

  const { kind, id } = parsed.data;
  const entity = ENTITIES[kind];
  const gate = await requireCapability(entity.capability);
  if (!gate.ok) return taxFail(gate.error);

  const table = kind === 'brand' ? ('brands' as const) : ('categories' as const);

  const blocked = (verdict: { reason: string; instead?: string }): TaxonomyState => ({
    ok: false,
    error: 'admin.catalog.errors.removeBlocked',
    fieldErrors: { [FORM_LEVEL]: [verdict.reason, verdict.instead ?? ''].filter(Boolean) },
  });

  try {
    const supabase = await createClient();

    const { data: before } = await supabase
      .from(table)
      .select('slug, name, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (!before) return taxFail('admin.catalog.errors.notFound');
    const row = before as { slug: string; name: unknown; deleted_at: string | null };

    // The bin is the only door — removing first is the reversible step that gives a chance to reconsider.
    if (row.deleted_at === null) {
      return blocked({
        reason: `This ${kind} is still in the list.`,
        instead: 'Remove it first. Deleting for good is only possible from the Removed section.',
      });
    }

    const attached = await taxonomyAttachments(kind, id);
    const verdict = canPurge(attached);
    if (!verdict.allowed) return blocked(verdict);

    // Audited before the delete: afterwards there is nothing left to read.
    await audit(`${kind}.purged`, entity.table, id, { slug: row.slug, name: row.name } as unknown as Json, {
      attached,
    } as unknown as Json);

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id)
      // So a record restored since the page loaded is not destroyed on a stale check.
      .not('deleted_at', 'is', null);

    if (error) {
      logger.error('purgeTaxonomy failed', { kind, cause: error.message });
      return taxFail('admin.errors.generic');
    }

    revalidatePublic([entity.tag, CACHE_TAGS.products]);
    revalidatePath(entity.adminPath);
    return { ok: true, data: { id } };
  } catch (error) {
    logger.error('purgeTaxonomy threw', { kind, ...describeError(error) });
    return taxFail('admin.errors.generic');
  }
}
