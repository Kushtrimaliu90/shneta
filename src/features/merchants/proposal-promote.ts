import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';

/**
 * docs/16 §9 — turning an approved proposal into a draft product with its photographs attached.
 *
 * ── What this does and does not decide ──
 *
 * It creates a **draft**. A draft is invisible on the storefront — `search_products` and `getProduct` both
 * filter on `status = 'published'` — and publishing needs `compliance.approve`, which neither the merchant
 * nor the product manager who approved the proposal holds (docs/06 §14). So what a merchant's proposal
 * produces is a head start: a row with the name, the brand, the form and the merchant's images already in
 * place. Every judgement that matters — the price, the copy, the ingredients, the warnings, the compliance
 * pass — still happens afterwards, by somebody who holds the capability for it.
 *
 * That is the honest version of "approved images appear on the site". They appear the moment the product is
 * published, and nobody's photograph reaches a customer without a compliance officer having looked.
 *
 * ── Why the copy happens here and not in SQL ──
 *
 * The images move from the private `merchant-proposals` bucket to the public `product-images` one, and
 * moving bytes between buckets means download-then-upload through the storage API. Postgres cannot reach
 * it, so `promote_proposal_to_draft` creates the rows and this copies the files.
 *
 * ── Why the service client ──
 *
 * `product-images` grants insert to `product_manager` only, and the *read* on `merchant-proposals` is
 * scoped to staff or the owning merchant — so a product manager could do both halves on their own session.
 * The service client is used anyway, and it belongs on the docs/02 §6 list, because this also runs from a
 * path with no session at all: an approval performed by a cron or a script. One code path that works for
 * every caller beats two that differ only in which client they hold.
 */

export interface PromotionResult {
  productId: string;
  slug: string;
  /** The merchant's asking price, written to the variant because a variant cannot exist without one. */
  provisionalPriceCents: number;
  imagesCopied: number;
  imagesFailed: number;
}

/**
 * Creates the draft and carries the images across.
 *
 * Image failures are **counted, not thrown**. A proposal whose product was created and whose third
 * photograph could not be copied is a product a reviewer can fix in the editor; a thrown error would leave
 * the approval half-applied, with `created_product_id` set and the merchant told nothing. The count comes
 * back so the screen can say what happened.
 */
export async function promoteProposal(
  proposalId: string,
  options?: { asService?: boolean },
): Promise<PromotionResult | null> {
  try {
    /*
     * `asService` is for the cron (§9.1), which has no session at all.
     *
     * `promote_proposal_to_draft` admits the service role or a product manager, and the SSR client carries
     * whichever of those the caller is. A cron carries neither — so the sweep passes this flag rather than
     * the function guessing from the absence of a session, which is the kind of inference that silently
     * turns into "anyone may promote" the day a session is missing for a different reason.
     */
    const supabase = options?.asService ? createAdminClient() : await createClient();

    // Rows first: if this refuses, nothing has been copied and there is nothing to unwind.
    const { data, error } = await supabase.rpc('promote_proposal_to_draft', {
      p_proposal_id: proposalId,
    });

    if (error) {
      logger.error('promote_proposal_to_draft failed', { proposalId, cause: error.message });
      return null;
    }

    const result = (data ?? {}) as {
      created?: boolean;
      product_id?: string;
      slug?: string;
      provisional_price_cents?: number;
    };

    if (!result.product_id) return null;

    // Already promoted: the function is idempotent, so this is a second approval, not a failure.
    if (result.created === false) {
      return {
        productId: result.product_id,
        slug: result.slug ?? '',
        provisionalPriceCents: result.provisional_price_cents ?? 0,
        imagesCopied: 0,
        imagesFailed: 0,
      };
    }

    const { copied, failed } = await copyImages(proposalId, result.product_id);

    return {
      productId: result.product_id,
      slug: result.slug ?? '',
      provisionalPriceCents: result.provisional_price_cents ?? 0,
      imagesCopied: copied,
      imagesFailed: failed,
    };
  } catch (error) {
    logger.error('promoteProposal threw', { proposalId, ...describeError(error) });
    return null;
  }
}

/**
 * Downloads each proposal image and uploads it under the product's own folder.
 *
 * `products/<product_id>/…` matches where the product editor puts its uploads, so an image that arrived
 * this way is indistinguishable from one a product manager added — which is the point. A reviewer
 * reordering or deleting them in the editor should not have to know where they came from.
 *
 * The original stays in the private bucket. It is the merchant's evidence of what it proposed, it costs
 * almost nothing, and deleting it would mean a rejected-then-reopened proposal had lost its photographs.
 */
async function copyImages(
  proposalId: string,
  productId: string,
): Promise<{ copied: number; failed: number }> {
  const admin = createAdminClient();

  const { data: proposal } = await admin
    .from('product_proposals')
    .select('payload')
    .eq('id', proposalId)
    .maybeSingle();

  const payload = (proposal as { payload: Record<string, unknown> } | null)?.payload ?? {};
  const paths = Array.isArray(payload.images)
    ? (payload.images as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];

  if (paths.length === 0) return { copied: 0, failed: 0 };

  let copied = 0;
  let failed = 0;

  for (const [index, path] of paths.entries()) {
    try {
      const { data: file, error: downloadError } = await admin.storage
        .from('merchant-proposals')
        .download(path);

      if (downloadError || !file) {
        failed += 1;
        logger.error('proposal image download failed', { path, cause: downloadError?.message });
        continue;
      }

      const name = path.split('/').pop() ?? `image-${index}`;
      const target = `products/${productId}/${name}`;

      const { error: uploadError } = await admin.storage
        .from('product-images')
        .upload(target, file, { upsert: true, contentType: file.type || 'image/jpeg' });

      if (uploadError) {
        failed += 1;
        logger.error('proposal image upload failed', { target, cause: uploadError.message });
        continue;
      }

      const { error: rowError } = await admin.from('product_images').insert({
        product_id: productId,
        storage_path: target,
        // Alt text is the catalogue team's to write: a filename is not a description of a photograph.
        alt: {},
        position: index,
      });

      if (rowError) {
        failed += 1;
        logger.error('proposal image row failed', { target, cause: rowError.message });
        continue;
      }

      copied += 1;
    } catch (error) {
      failed += 1;
      logger.error('proposal image copy threw', { path, ...describeError(error) });
    }
  }

  return { copied, failed };
}

/**
 * A signed URL for one proposal image, for the review screen.
 *
 * Five minutes, minted per request by the route handler that serves the thumbnail — the same shape as the
 * KYB documents (§4). The bucket is private, so this is the only way a reviewer sees the photograph before
 * deciding whether it should be public at all.
 */
export async function signProposalImage(path: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('merchant-proposals')
      .createSignedUrl(path, 300);

    if (error) {
      logger.error('signProposalImage failed', { cause: error.message });
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    logger.error('signProposalImage threw', describeError(error));
    return null;
  }
}
