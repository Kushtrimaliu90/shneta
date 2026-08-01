'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, ok } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import {
  productCertificationsSchema,
  productIngredientRowSchema,
  productIngredientsSchema,
} from '@/features/catalog/admin-schemas';
import type { CatalogErrorKey, CatalogState } from '@/features/catalog/admin-actions';

/**
 * docs/06 §3.3 and §3.6 — the supplement label and its certifications.
 *
 * Separate from `admin-actions.ts` because these two write **join tables**, and a join table is
 * saved by replacement rather than by update: the operator's submission is the complete set, so
 * the action deletes what is no longer there and inserts what is new. Mixing that pattern in
 * with the row-at-a-time updates next door made both harder to read.
 *
 * Both are what a customer sees on the product page — the %NRV table and the certification
 * badges — so both purge the product's cache tag.
 */

function labelFail(error: CatalogErrorKey): CatalogState {
  return fail<CatalogErrorKey, { id?: string }>(error);
}

/** The product's slug, needed to purge its tag. `null` when the product is gone. */
async function slugOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productId: string,
): Promise<string | null> {
  const { data } = await supabase.from('products').select('slug').eq('id', productId).maybeSingle();
  return (data as { slug: string } | null)?.slug ?? null;
}

/**
 * A decimal an editor typed, as a number — or `null`.
 *
 * `Number()` on its own accepts `1e3`, `Infinity` and `0x10`; a label amount is a plain decimal
 * and anything else is a typo worth dropping rather than storing. The same reasoning as
 * `toCents` in `lib/money.ts`, at lower stakes.
 */
function toAmount(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim().replace(',', '.');
  if (!trimmed) return null;
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Replaces the whole ingredient label.
 *
 * The rows arrive as JSON in one field. FormData can carry repeated keys, but a composite row —
 * ingredient, amount, unit, %NRV, per-serving — reconstructed from five parallel arrays depends
 * on those arrays staying index-aligned, and a browser that omits an unchecked checkbox breaks
 * exactly that alignment. One JSON field has no such failure mode.
 */
export async function saveProductIngredients(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return labelFail(gate.error);

  const parsed = productIngredientsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return labelFail('admin.catalog.errors.checkFields');

  let rows: unknown;
  try {
    rows = JSON.parse(parsed.data.rows);
  } catch {
    return labelFail('admin.catalog.errors.checkFields');
  }

  const parsedRows = productIngredientRowSchema.array().max(60).safeParse(rows);
  if (!parsedRows.success) return labelFail('admin.catalog.errors.checkFields');

  /*
   * The same ingredient twice would violate the composite primary key and fail as a generic
   * database error. Caught here so the message can be about the label rather than about SQL —
   * and it happens easily, since "Vitamin D" and "Vitamin D3" are separate rows in the picker.
   */
  const seen = new Set<string>();
  for (const row of parsedRows.data) {
    if (seen.has(row.ingredientId)) return labelFail('admin.catalog.errors.duplicateIngredient');
    seen.add(row.ingredientId);
  }

  try {
    const supabase = await createClient();
    const slug = await slugOf(supabase, parsed.data.productId);
    if (!slug) return labelFail('admin.catalog.errors.notFound');

    /*
     * Delete-then-insert, not upsert.
     *
     * The submission is the complete label, so an ingredient the operator removed has to
     * disappear — an upsert would leave it there. The two statements are not in one transaction
     * (PostgREST has no client-side transaction), so a failure between them leaves the label
     * empty rather than half-wrong. That is the better of the two failure modes: an empty
     * ingredient table is obviously broken and the operator will re-save, whereas a silently
     * merged one looks correct and is not.
     */
    const { error: clearError } = await supabase
      .from('product_ingredients')
      .delete()
      .eq('product_id', parsed.data.productId);

    if (clearError) {
      logger.error('Clearing product ingredients failed', { cause: clearError.message });
      return labelFail('admin.errors.generic');
    }

    if (parsedRows.data.length > 0) {
      const { error } = await supabase.from('product_ingredients').insert(
        parsedRows.data.map((row, index) => ({
          product_id: parsed.data.productId,
          ingredient_id: row.ingredientId,
          amount: toAmount(row.amount),
          unit: row.unit || null,
          nrv_pct: toAmount(row.nrvPct),
          per_serving: row.perServing,
          position: index,
        })),
      );

      if (error) {
        logger.error('Inserting product ingredients failed', { cause: error.message });
        return labelFail('admin.errors.generic');
      }
    }

    await audit('product.label_updated', 'product', parsed.data.productId, null, {
      count: parsedRows.data.length,
    });

    revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.product(slug), CACHE_TAGS.ingredients]);
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('saveProductIngredients threw', describeError(error));
    return labelFail('admin.errors.generic');
  }
}

/**
 * Replaces the product's certifications.
 *
 * `products.manage`, not `compliance.approve`: attaching an "Organic" badge is a catalogue fact
 * the product manager enters from the supplier's paperwork. Whether it is *true* is what
 * compliance reviews before approving — which is why the compliance queue shows them.
 */
export async function saveProductCertifications(
  _previous: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return labelFail(gate.error);

  const parsed = productCertificationsSchema.safeParse({
    productId: formData.get('productId'),
    certificationIds: formData.getAll('certificationIds'),
  });
  if (!parsed.success) return labelFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();
    const slug = await slugOf(supabase, parsed.data.productId);
    if (!slug) return labelFail('admin.catalog.errors.notFound');

    const { error: clearError } = await supabase
      .from('product_certifications')
      .delete()
      .eq('product_id', parsed.data.productId);

    if (clearError) {
      logger.error('Clearing certifications failed', { cause: clearError.message });
      return labelFail('admin.errors.generic');
    }

    if (parsed.data.certificationIds.length > 0) {
      const { error } = await supabase.from('product_certifications').insert(
        parsed.data.certificationIds.map((certificationId) => ({
          product_id: parsed.data.productId,
          certification_id: certificationId,
        })),
      );

      if (error) {
        logger.error('Inserting certifications failed', { cause: error.message });
        return labelFail('admin.errors.generic');
      }
    }

    await audit('product.certifications_updated', 'product', parsed.data.productId, null, {
      count: parsed.data.certificationIds.length,
    });

    revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.product(slug)]);
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('saveProductCertifications threw', describeError(error));
    return labelFail('admin.errors.generic');
  }
}
