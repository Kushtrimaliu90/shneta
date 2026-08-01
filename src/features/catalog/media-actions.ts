'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePublic } from '@/lib/cache';
import { CACHE_TAGS } from '@/lib/constants';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';

/**
 * docs/06 §3.4 — product media.
 *
 * **The browser uploads straight to Supabase Storage, not through this server.** The action
 * mints a signed upload URL, the client PUTs the bytes to it, then a second action records the
 * row. Three reasons that is worth the extra round trip:
 *
 *   · Server Actions have a 1 MB body limit by default, and product images are capped at 2 MB.
 *     Raising the limit would route every image through the Node process, doubling bandwidth
 *     and holding the file in memory for no gain.
 *   · The storage policies (migration 12) already restrict writes to `product_manager` at the
 *     storage layer, so the upload is authorised where the bytes land rather than only here.
 *   · The bucket enforces its own 2 MB ceiling and MIME allowlist, which a forged request
 *     cannot talk its way past.
 *
 * The cost is a window where an object exists with no `product_images` row — if the browser
 * dies between the PUT and the attach. Orphans are invisible to the storefront (nothing reads
 * the bucket directly) and cost a few kilobytes; the client also deletes on failure. A sweep of
 * unreferenced objects belongs with the housekeeping cron, noted rather than built.
 */

export type MediaErrorKey =
  | 'admin.errors.forbidden'
  | 'admin.errors.generic'
  | 'admin.catalog.errors.checkFields'
  | 'admin.catalog.errors.uploadFailed'
  | 'admin.catalog.errors.fileTooLarge'
  | 'admin.catalog.errors.fileType';

export type MediaState = ActionResult<{ path?: string; token?: string }, MediaErrorKey> | null;

function mediaFail(error: MediaErrorKey): MediaState {
  return fail<MediaErrorKey, { path?: string; token?: string }>(error);
}

/** Mirrors the bucket's own limits so the browser is told before it uploads two megabytes. */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'] as const;

const signSchema = z.object({
  productId: z.string().uuid(),
  contentType: z.enum(ALLOWED),
  size: z.coerce.number().int().positive().max(MAX_BYTES),
});

/**
 * Mints a one-shot upload URL for a product image.
 *
 * The path is `{productId}/{uuid}.{ext}` — never the uploaded filename. A filename from a
 * browser is attacker-controlled and arrives with whatever encoding, spaces, unicode or
 * traversal segments the client felt like sending; a UUID has none of those problems and the
 * original name carries no information worth keeping, since the alt text is what matters.
 */
export async function createImageUploadUrl(
  _previous: MediaState,
  formData: FormData,
): Promise<MediaState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return mediaFail(gate.error);

  const parsed = signSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    // Distinguish the two the operator can act on: too big, or wrong format.
    const issues = parsed.error.flatten().fieldErrors;
    if (issues.size) return mediaFail('admin.catalog.errors.fileTooLarge');
    if (issues.contentType) return mediaFail('admin.catalog.errors.fileType');
    return mediaFail('admin.catalog.errors.checkFields');
  }

  const extension =
    { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/avif': 'avif' }[
      parsed.data.contentType
    ] ?? 'bin';

  const path = `${parsed.data.productId}/${randomUUID()}.${extension}`;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('product-images')
      .createSignedUploadUrl(path);

    if (error || !data) {
      logger.error('Signed upload URL failed', { cause: error?.message });
      return mediaFail('admin.catalog.errors.uploadFailed');
    }

    return ok({ path: data.path, token: data.token });
  } catch (error) {
    logger.error('createImageUploadUrl threw', describeError(error));
    return mediaFail('admin.errors.generic');
  }
}

const attachSchema = z.object({
  productId: z.string().uuid(),
  path: z.string().trim().min(3).max(300),
  altSq: z.string().trim().max(200).optional().or(z.literal('')),
  altEn: z.string().trim().max(200).optional().or(z.literal('')),
});

/** Records an uploaded object as a product image, appended last. */
export async function attachProductImage(
  _previous: MediaState,
  formData: FormData,
): Promise<MediaState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return mediaFail(gate.error);

  const parsed = attachSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return mediaFail('admin.catalog.errors.checkFields');
  const input = parsed.data;

  /*
   * The path must live under this product's own prefix. `createImageUploadUrl` always builds it
   * that way, but this action takes the path from the client, and without the check a product
   * manager could attach any object in the bucket — including one belonging to a product they
   * were not editing. Cheap to verify, and the alternative is trusting a round trip through the
   * browser.
   */
  if (!input.path.startsWith(`${input.productId}/`)) {
    logger.info('Rejected image path outside the product prefix', { path: input.path });
    return mediaFail('admin.catalog.errors.checkFields');
  }

  try {
    const supabase = await createClient();

    const { data: product } = await supabase
      .from('products')
      .select('slug')
      .eq('id', input.productId)
      .maybeSingle();
    if (!product) return mediaFail('admin.errors.generic');

    // Appended last. `position` is a plain int and the gallery reads in ascending order.
    const { data: existing } = await supabase
      .from('product_images')
      .select('position')
      .eq('product_id', input.productId)
      .order('position', { ascending: false })
      .limit(1);

    const nextPosition = ((existing ?? [])[0]?.position ?? -1) + 1;

    const alt: Record<string, string> = {};
    if (input.altSq) alt.sq = input.altSq;
    if (input.altEn) alt.en = input.altEn;

    const { error } = await supabase.from('product_images').insert({
      product_id: input.productId,
      storage_path: input.path,
      alt,
      position: nextPosition,
    });

    if (error) {
      logger.error('Attach image failed', { cause: error.message });
      return mediaFail('admin.errors.generic');
    }

    await audit('product.image_added', 'product', input.productId, null, { path: input.path });

    revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.product((product as { slug: string }).slug)]);
    revalidatePath(`/admin/products/${input.productId}`);
    return ok({ path: input.path });
  } catch (error) {
    logger.error('attachProductImage threw', describeError(error));
    return mediaFail('admin.errors.generic');
  }
}

/**
 * A void-returning wrapper for `<form action={…}>`.
 *
 * React requires a form action to resolve to `void`; `removeProductImage` resolves to a
 * `MediaState` so it can also be driven from `useActionState`. Same pattern as the cart's
 * quantity stepper in M4 — the wrapper exists so one action can serve both call shapes without
 * either having to pretend.
 *
 * Discarding the result is acceptable here specifically: removal revalidates the page, so a
 * failure shows as the image still being there, and the action has already logged why.
 */
export async function removeProductImageForm(formData: FormData): Promise<void> {
  await removeProductImage(null, formData);
}

const removeSchema = z.object({
  productId: z.string().uuid(),
  imageId: z.string().uuid(),
});

/**
 * Removes an image — the row **and** the object.
 *
 * Unlike a variant, an image has no downstream references worth preserving: `order_items`
 * snapshots `image_path` as text at purchase time, so deleting the file cannot orphan an order.
 * Leaving the bytes behind would just accumulate storage nobody can reach.
 */
export async function removeProductImage(
  _previous: MediaState,
  formData: FormData,
): Promise<MediaState> {
  const gate = await requireCapability('products.manage');
  if (!gate.ok) return mediaFail(gate.error);

  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return mediaFail('admin.catalog.errors.checkFields');

  try {
    const supabase = await createClient();

    const { data: image } = await supabase
      .from('product_images')
      .select('storage_path, products ( slug )')
      .eq('id', parsed.data.imageId)
      .maybeSingle();

    if (!image) return mediaFail('admin.errors.generic');
    const row = image as unknown as { storage_path: string; products: { slug: string } | null };

    const { error } = await supabase.from('product_images').delete().eq('id', parsed.data.imageId);

    if (error) {
      logger.error('Remove image row failed', { cause: error.message });
      return mediaFail('admin.errors.generic');
    }

    /*
     * The row first, the object second. If the storage delete fails the operator still sees the
     * image gone, which is what they asked for, and the leftover bytes are invisible — whereas
     * deleting the object first and failing on the row would leave a broken image on a live
     * product page.
     */
    const { error: storageError } = await supabase.storage
      .from('product-images')
      .remove([row.storage_path]);

    if (storageError) {
      logger.error('Orphaned storage object after image delete', {
        path: row.storage_path,
        cause: storageError.message,
      });
    }

    await audit(
      'product.image_removed',
      'product',
      parsed.data.productId,
      {
        path: row.storage_path,
      },
      null,
    );

    if (row.products?.slug) {
      revalidatePublic([CACHE_TAGS.products, CACHE_TAGS.product(row.products.slug)]);
    }
    revalidatePath(`/admin/products/${parsed.data.productId}`);
    return ok({});
  } catch (error) {
    logger.error('removeProductImage threw', describeError(error));
    return mediaFail('admin.errors.generic');
  }
}
