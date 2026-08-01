import { z } from 'zod';

/** docs/02 §7 — one schema per mutation, reused on both sides of the boundary. */

const uuid = z.string().uuid();

/**
 * A slug: lowercase, hyphenated, no leading or trailing hyphen (CLAUDE.md §8).
 *
 * Validated rather than auto-generated from the name. Transliterating Albanian for a URL is a
 * judgement call — `Vitaminë` could reasonably be `vitamine` or `vitamina` — and a slug is
 * permanent after publish, so it is worth a human deciding once rather than a regex deciding
 * every time.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(3, 'SLUG_TOO_SHORT')
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'SLUG_INVALID');

/**
 * A bilingual field.
 *
 * Albanian is required, English optional. That asymmetry is the product decision from
 * docs/08 §1: `sq` is the default locale and the storefront falls back to it, so a product with
 * no English name renders in Albanian to an English visitor — degraded but correct. A product
 * with no Albanian name has nothing to fall back to.
 */
function localized(max: number, requireSq = true) {
  return z.object({
    sq: requireSq ? z.string().trim().min(1, 'REQUIRED').max(max) : z.string().trim().max(max),
    en: z.string().trim().max(max).optional().or(z.literal('')),
  });
}

/** docs/06 §3.1 — the General tab. */
export const productGeneralSchema = z.object({
  productId: uuid,
  slug: slugSchema,
  brandId: uuid,
  name: localized(160),
  subtitle: localized(240, false),
  description: localized(8000, false),
  howToUse: localized(2000, false),
  warnings: localized(2000, false),
  form: z
    .enum([
      'capsule',
      'tablet',
      'softgel',
      'powder',
      'liquid',
      'gummy',
      'bar',
      'spray',
      'sachet',
      'other',
    ])
    .optional()
    .or(z.literal('')),
  servingSize: z.string().trim().max(120).optional().or(z.literal('')),
  dietaryTags: z.array(z.string()).default([]),
  isFeatured: z.coerce.boolean().default(false),
  primaryCategoryId: z.union([uuid, z.literal('')]).optional(),
  categoryIds: z.array(uuid).default([]),
  goalIds: z.array(uuid).default([]),
});

/**
 * docs/06 §3.2 — one variant row.
 *
 * Prices arrive as euro strings and are converted by the action with `toCents`, which throws on
 * anything that is not a plain amount. Zod's `coerce.number()` would accept `1e3` and quietly
 * price something at €1000.
 */
export const variantSchema = z.object({
  productId: uuid,
  /** Absent when creating. */
  variantId: z.union([uuid, z.literal('')]).optional(),
  sku: z
    .string()
    .trim()
    .min(2, 'REQUIRED')
    .max(64)
    // Uppercase alphanumerics and hyphens: a SKU is read aloud, typed into a courier form and
    // scanned. Spaces and case variation make all three worse.
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'SKU_INVALID'),
  name: localized(120),
  price: z.string().trim().min(1, 'REQUIRED'),
  compareAtPrice: z.string().trim().optional().or(z.literal('')),
  isActive: z.coerce.boolean().default(true),
  isDefault: z.coerce.boolean().default(false),
});

export const deleteVariantSchema = z.object({
  productId: uuid,
  variantId: uuid,
});

/**
 * docs/07 §10 — the publishing workflow.
 *
 * `published` is absent: it is not something anyone sets directly. It is the result of
 * `approveProduct`, which is compliance's action and stamps `approved_by` in the same write —
 * and `guard_product_publish` refuses the status without that stamp regardless.
 */
export const productStatusSchema = z.object({
  productId: uuid,
  to: z.enum(['draft', 'pending_review', 'archived']),
});

export const approveProductSchema = z.object({
  productId: uuid,
  /** Compliance may approve without publishing — an approved draft is a legitimate state. */
  publish: z.coerce.boolean().default(true),
});

export const rejectProductSchema = z.object({
  productId: uuid,
  note: z.string().trim().min(3, 'REASON_REQUIRED').max(1000),
});

export const createProductSchema = z.object({
  slug: slugSchema,
  brandId: uuid,
  nameSq: z.string().trim().min(1, 'REQUIRED').max(160),
});

/**
 * docs/06 §3.3 — the ingredient label, submitted as a whole.
 *
 * One row per ingredient, all of them at once, because a supplement label is read as a unit:
 * the amounts have to add up against the serving size, and saving row four independently of
 * row three invites a label that is internally inconsistent between two saves.
 *
 * Amount arrives as a string because it is a decimal an editor types ("2.5"), and `coerce.number`
 * would silently accept `1e3`. It is parsed by the action with the same care as a price.
 */
export const productIngredientRowSchema = z.object({
  ingredientId: uuid,
  amount: z.string().trim().max(20).optional().or(z.literal('')),
  unit: z.string().trim().max(16).optional().or(z.literal('')),
  nrvPct: z.string().trim().max(8).optional().or(z.literal('')),
  perServing: z.coerce.boolean().default(true),
});

export const productIngredientsSchema = z.object({
  productId: uuid,
  /** Serialised as JSON: a variable-length list of composite rows does not survive FormData flat. */
  rows: z.string().max(20000),
});

/**
 * docs/06 §3.5 — SEO overrides.
 *
 * Both locales optional in both fields. Empty means "derive it", which is what the PDP does when
 * the override is absent — an override that has to be filled in for every product is an override
 * nobody maintains.
 */
export const productSeoSchema = z.object({
  productId: uuid,
  titleSq: z.string().trim().max(70).optional().or(z.literal('')),
  titleEn: z.string().trim().max(70).optional().or(z.literal('')),
  descriptionSq: z.string().trim().max(180).optional().or(z.literal('')),
  descriptionEn: z.string().trim().max(180).optional().or(z.literal('')),
});

/** docs/06 §3.6 — which certifications this product carries. */
export const productCertificationsSchema = z.object({
  productId: uuid,
  certificationIds: z.array(uuid).default([]),
});
