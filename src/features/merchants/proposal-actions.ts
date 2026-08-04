'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { getMyMerchant } from '@/features/merchants/queries';
import { sendProposalDecided } from '@/features/merchants/email';
import { promoteProposal } from '@/features/merchants/proposal-promote';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §4 — a merchant asking for a product BioCode does not list.
 *
 * ── Why this exists at all ──
 *
 * Merchants never create products (§1): one canonical page per product is what makes "who else has this
 * in stock?" a computable question. But a merchant holding stock of something BioCode has never listed
 * has nowhere to put it, and the honest answer to that is a request, not a listing.
 *
 * So a proposal is **an argument**. It carries what the merchant knows — name, brand, form, barcode, a
 * link to the manufacturer, and photographs — and BioCode decides.
 *
 * Approving it creates a **draft** product with those photographs attached (docs/16 §9), and the
 * distinction from what §1 forbids is exact: a draft is invisible on the storefront, and publishing needs
 * `compliance.approve`, which neither the merchant nor the reviewer approving the proposal holds. What a
 * proposal produces is a head start for the catalogue team, not a listing.
 *
 * Step 6 shipped without this, on the reasoning that any auto-creation was merchant-created listings with
 * a delay. Two facts moved the line: `created_product_id` has existed since migration 28 and was wired to
 * nothing, so the schema always anticipated the link; and the compliance gate means a draft cannot reach a
 * customer by itself.
 */

export type ProposalErrorKey =
  | 'merchant.proposals.errors.generic'
  | 'merchant.proposals.errors.invalid'
  | 'merchant.proposals.errors.notMerchant'
  | 'merchant.proposals.errors.tooMany'
  | 'admin.errors.forbidden';

export type ProposalState = ActionResult<{ proposalId?: string }, ProposalErrorKey> | null;

function no(error: ProposalErrorKey): ProposalState {
  return fail<ProposalErrorKey, { proposalId?: string }>(error);
}

const proposalSchema = z.object({
  productName: z.string().trim().min(2, 'required').max(160),
  brandName: z.string().trim().min(2, 'required').max(120),
  /** Free text: capsules, powder, drops. Not an enum, because a merchant knows forms BioCode does not. */
  form: z.string().trim().max(80).optional().or(z.literal('')),
  variantName: z.string().trim().max(120).optional().or(z.literal('')),
  /** EAN or UPC. Optional, and not validated as a checksum: a supplement box often has neither. */
  barcode: z.string().trim().max(32).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url('invalid').max(500).optional().or(z.literal('')),
  /** What they hold and what they would ask, so a reviewer can judge whether it is worth listing. */
  stockOnHand: z.coerce.number().int().min(0).max(1_000_000),
  askingPriceEuro: z
    .string()
    .trim()
    .min(1, 'required')
    .transform((value) => Number(value.replace(',', '.')))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= 100_000, 'range')
    .transform((euro) => Math.round(euro * 100)),
  note: z.string().trim().min(10, 'required').max(2000),
});

const decisionSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'needs_info']),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Submits a proposal.
 *
 * Capped at twenty open proposals per merchant. Not a rate limit on time — a merchant onboarding a real
 * catalogue legitimately submits several in an afternoon — but a cap on how many can be *waiting*, so a
 * merchant cannot make the review queue unusable for everybody else by pasting its whole spreadsheet in.
 */
export async function submitProposal(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') return no('merchant.proposals.errors.notMerchant');

  const parsed = proposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.proposals.errors.invalid');
  const input = parsed.data;

  /*
   * The image paths, **verified rather than trusted** (docs/16 §9).
   *
   * The browser uploaded the bytes and tells us where it put them, exactly as the KYB documents do — and
   * for the same reason, a path outside this merchant's own folder is refused here. The storage policy
   * would already stop the *upload*, but nothing stops a crafted submission naming somebody else's
   * object, and an approved proposal copies its images onto a public product page.
   *
   * `getAll`, not `get`: the uploader emits one hidden input per image, and `Object.fromEntries` keeps
   * only the last of a repeated key — so the schema above cannot see these at all.
   */
  const imagePaths = formData
    .getAll('imagePaths')
    .map((value) => String(value))
    .filter((path) => path.length > 0);

  if (imagePaths.length > 6) return no('merchant.proposals.errors.invalid');

  const prefix = `proposals/${merchant.id}/`;
  for (const path of imagePaths) {
    if (
      !path.startsWith(prefix) ||
      path.length <= prefix.length ||
      path.includes('..') ||
      path.slice(prefix.length).includes('/')
    ) {
      logger.info('proposal image path rejected', { merchantId: merchant.id });
      return no('merchant.proposals.errors.invalid');
    }
  }

  try {
    const supabase = await createClient();

    /*
     * Twenty open, and **batch rows do not count** (docs/16 §9.1).
     *
     * The cap exists so one merchant cannot make the review queue unusable for everybody else, and a batch
     * costs the reviewer one table rather than 200 cards — so batches are bounded separately, in SQL: 200
     * rows each, three open at a time. Counting them here as well would mean a merchant that pasted its
     * catalogue could no longer propose the one product it thought of afterwards, which is the opposite of
     * what either limit is for.
     */
    const { count } = await supabase
      .from('product_proposals')
      .select('id', { count: 'exact', head: true })
      .is('batch_id', null)
      .in('status', ['pending', 'needs_info']);

    if ((count ?? 0) >= 20) return no('merchant.proposals.errors.tooMany');

    const { data, error } = await supabase
      .from('product_proposals')
      .insert({
        merchant_id: merchant.id,
        status: 'pending',
        /*
         * One jsonb payload rather than fifteen columns, because the shape of a proposal is a product
         * form BioCode has not designed yet — and a table of nullable columns for fields nobody has
         * agreed on is a migration for every question a reviewer thinks to ask.
         */
        payload: {
          product_name: input.productName,
          brand_name: input.brandName,
          form: input.form || null,
          variant_name: input.variantName || null,
          barcode: input.barcode || null,
          source_url: input.sourceUrl || null,
          stock_on_hand: input.stockOnHand,
          asking_price_cents: input.askingPriceEuro,
          note: input.note,
          images: imagePaths,
        } as unknown as Json,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('submitProposal failed', { cause: error.message });
      return no('merchant.proposals.errors.generic');
    }
    if (!data) return no('merchant.proposals.errors.generic');

    revalidatePath('/merchant/proposals');
    revalidatePath('/admin/merchants/proposals');
    return ok({ proposalId: (data as { id: string }).id });
  } catch (error) {
    logger.error('submitProposal threw', describeError(error));
    return no('merchant.proposals.errors.generic');
  }
}

/**
 * Decides a proposal.
 *
 * ── What "approve" does, and what it leaves to somebody else ──
 *
 * It records the decision **and** creates a draft product carrying the merchant's photographs, the name,
 * the brand and the form. What it does not do is decide anything commercial: the retail price is written as
 * the merchant's asking price and flagged provisional, and the copy, the ingredients, the warnings and the
 * compliance pass are all still ahead of it.
 *
 * The promotion failing does not fail the approval. The decision is recorded and the merchant is told; a
 * draft a product manager has to create by hand is a smaller loss than a decision nobody can see.
 *
 * `needs_info` is a real status here, unlike on a merchant application: the RLS policy lets a merchant
 * *edit* a proposal in `needs_info` and resubmit it, which is the whole point of asking.
 */
export async function decideProposal(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.proposals.errors.invalid');
  const input = parsed.data;

  if (input.decision !== 'approve' && (input.note ?? '').trim().length < 5) {
    // A rejection or a request for more, with no words, is one the merchant cannot act on.
    return no('merchant.proposals.errors.invalid');
  }

  try {
    const supabase = await createClient();

    const status =
      input.decision === 'approve'
        ? 'approved'
        : input.decision === 'reject'
          ? 'rejected'
          : 'needs_info';

    const { data, error } = await supabase
      .from('product_proposals')
      .update({
        status,
        reviewer_note: input.note ?? null,
        reviewed_by: gate.actor.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', input.proposalId)
      // Only an open proposal can be decided; a stale tab must not re-decide a closed one.
      .in('status', ['pending', 'needs_info'])
      .select('id, merchant_id, payload')
      .maybeSingle();

    if (error) {
      logger.error('decideProposal failed', { cause: error.message });
      return no('merchant.proposals.errors.generic');
    }
    if (!data) return no('merchant.proposals.errors.invalid');

    /*
     * Approval creates a **draft** product with the merchant's photographs attached (docs/16 §9).
     *
     * Not a published one: publishing needs `compliance.approve`, which the reviewer approving this does
     * not hold. So what this produces is a head start for the catalogue team, and the price, the copy and
     * the compliance pass are still somebody else's decision.
     *
     * A failure here does **not** fail the approval. The decision has been recorded and the merchant will
     * be told; a proposal approved with no draft behind it is something a product manager can create by
     * hand, and losing the recorded decision would be worse.
     */
    let promotion: Awaited<ReturnType<typeof promoteProposal>> = null;
    if (status === 'approved') {
      promotion = await promoteProposal(input.proposalId);
      if (!promotion) {
        logger.error('proposal approved but not promoted', { proposalId: input.proposalId });
      }
    }

    await audit(`proposal.${status}`, 'product_proposal', input.proposalId, null, {
      note: input.note ?? null,
      merchant_id: (data as { merchant_id: string }).merchant_id,
      product_id: promotion?.productId ?? null,
      images_copied: promotion?.imagesCopied ?? 0,
      images_failed: promotion?.imagesFailed ?? 0,
    } as unknown as Json);

    /*
     * The product name comes back off the row rather than from the form: the reviewer never typed it,
     * and the email's subject line has to name the thing the merchant proposed.
     */
    const decided = data as { merchant_id: string; payload: Record<string, unknown> | null };
    const proposedName =
      typeof decided.payload?.product_name === 'string' ? decided.payload.product_name : '';

    await sendProposalDecided(
      decided.merchant_id,
      proposedName,
      status,
      input.note ?? null,
    );

    /*
     * `'layout'`, so the batch page under this path refreshes too (docs/16 §9.1).
     *
     * A row rejected from inside a batch table is decided by this action, and revalidating only
     * `/admin/merchants/proposals` leaves the child route `/admin/merchants/proposals/[batchId]` serving the
     * row as still pending — the decision recorded, the screen disagreeing.
     */
    revalidatePath('/admin/merchants/proposals', 'layout');
    revalidatePath('/merchant/proposals', 'layout');
    if (promotion) revalidatePath('/admin/products');
    return ok({ proposalId: input.proposalId, productId: promotion?.productId });
  } catch (error) {
    logger.error('decideProposal threw', describeError(error));
    return no('merchant.proposals.errors.generic');
  }
}
