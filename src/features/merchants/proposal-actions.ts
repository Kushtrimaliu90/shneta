'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  proposalBulkDecisionSchema,
  proposalOfferSchema,
} from '@/features/merchants/proposal-schemas';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, auditMany, requireCapability } from '@/features/admin/audit';
import { getMyMerchant } from '@/features/merchants/queries';
import { sendProposalDecided } from '@/features/merchants/email';
import { promoteProposal } from '@/features/merchants/proposal-promote';
import { createOfferFromProposal } from '@/features/merchants/proposal-offer';
import { sweepApprovedProposals, sweepProposalOffers } from '@/features/merchants/proposal-sweep';
import {
  classifySkips,
  dedupeIds,
  type BulkProposalDecision,
} from '@/features/merchants/decisions';
import type { Json } from '@/lib/supabase/database.types';
import { keepSubmitted } from '@/lib/keep-submitted';

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
async function submitProposalImpl(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved')
    return no('merchant.proposals.errors.notMerchant');

  const parsed = proposalOfferSchema.safeParse(Object.fromEntries(formData));
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
          // Read back by `create_offer_from_proposal`, which regex-guards every cast.
          low_stock_threshold: input.lowStockThreshold,
          handling_days: input.handlingDays,
          merchant_sku: input.merchantSku || null,
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

export const submitProposal = keepSubmitted(submitProposalImpl);

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
    let offer: Awaited<ReturnType<typeof createOfferFromProposal>> = null;
    if (status === 'approved') {
      promotion = await promoteProposal(input.proposalId);
      if (!promotion) {
        logger.error('proposal approved but not promoted', { proposalId: input.proposalId });
      }

      /*
       * The offer, minted from the terms the reviewer has just read.
       *
       * Only when promotion produced a product, because the offer hangs off its variant. And it
       * follows the same rule as promotion above: a failure here does not fail the approval. The
       * decision is recorded, the merchant is told, and `proposals_awaiting_offer` picks the row up on
       * the nightly sweep — which is the whole reason that queue is derived rather than flagged.
       */
      if (promotion?.productId) {
        offer = await createOfferFromProposal(input.proposalId);
        if (!offer?.created) {
          logger.warn('proposal promoted but offer not minted', {
            proposalId: input.proposalId,
            reason: offer?.reason ?? 'rpc_failed',
          });
        }
      }
    }

    await audit(`proposal.${status}`, 'product_proposal', input.proposalId, null, {
      note: input.note ?? null,
      merchant_id: (data as { merchant_id: string }).merchant_id,
      product_id: promotion?.productId ?? null,
      images_copied: promotion?.imagesCopied ?? 0,
      images_failed: promotion?.imagesFailed ?? 0,
      offer_id: offer?.offerId ?? null,
    } as unknown as Json);

    /*
     * The product name comes back off the row rather than from the form: the reviewer never typed it,
     * and the email's subject line has to name the thing the merchant proposed.
     */
    const decided = data as { merchant_id: string; payload: Record<string, unknown> | null };
    const proposedName =
      typeof decided.payload?.product_name === 'string' ? decided.payload.product_name : '';

    await sendProposalDecided(decided.merchant_id, proposedName, status, input.note ?? null);

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

// ── Several at once ─────────────────────────────────────────────────────────

/**
 * How many drafts are created inside the request, before the rest is left to the cron.
 *
 * The same number `decideBatch` uses, and for the same reason: approving twenty proposals means twenty
 * draft products and every photograph copied between storage buckets, which is far past what a request
 * should hold open. A bounded slice runs here so the reviewer sees the feature work; the housekeeping
 * cron drains the tail from `proposals_awaiting_promotion`.
 */
const INLINE_PROMOTIONS = 5;

export type BulkProposalState = ActionResult<BulkProposalDecision, ProposalErrorKey> | null;

/**
 * Approves or rejects a selected set of proposals.
 *
 * Same one-statement shape as the offer version — a single guarded `UPDATE … .in('id', ids).in('status',
 * decidable).select()`, whose `RETURNING` list is the partial-failure report — with the deferred tail
 * proposals carry on top.
 *
 * ── What "approved" means here, and what it does not ──
 *
 * It records the decision for every row that was still open, and it creates a bounded number of draft
 * products with the merchants' photographs attached. It decides nothing commercial: the retail price is
 * the merchant's asking price flagged provisional, and the copy, the ingredients and the compliance pass
 * are all still ahead of it. Publishing needs `compliance.approve`, which the reviewer approving this
 * does not hold — so nothing here can reach the storefront.
 *
 * Promotion failing does not fail the approval, exactly as on the single path: the decision is recorded
 * and the merchant is told, and the derived queue picks the row up on the nightly sweep.
 */
export async function decideProposalsBulk(
  _previous: BulkProposalState,
  formData: FormData,
): Promise<BulkProposalState> {
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return fail<ProposalErrorKey, BulkProposalDecision>('admin.errors.forbidden');

  const parsed = proposalBulkDecisionSchema.safeParse({
    proposalIds: dedupeIds(formData.getAll('proposalIds')),
    decision: formData.get('decision'),
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    return fail<ProposalErrorKey, BulkProposalDecision>('merchant.proposals.errors.invalid');
  }
  const input = parsed.data;

  if (input.decision === 'reject' && (input.note ?? '').trim().length < 5) {
    return fail<ProposalErrorKey, BulkProposalDecision>('merchant.proposals.errors.invalid');
  }

  const approving = input.decision === 'approve';
  const DECIDABLE = ['pending', 'needs_info'];

  try {
    const supabase = await createClient();

    const { data: beforeRows, error: readError } = await supabase
      .from('product_proposals')
      .select('id, status, merchant_id, batch_id, payload')
      .in('id', input.proposalIds);

    if (readError) {
      logger.error('decideProposalsBulk pre-read failed', { cause: readError.message });
      return fail<ProposalErrorKey, BulkProposalDecision>('merchant.proposals.errors.generic');
    }

    interface BeforeRow {
      id: string;
      status: string;
      merchant_id: string;
      batch_id: string | null;
      payload: Record<string, unknown> | null;
    }
    const before = new Map(
      ((beforeRows ?? []) as unknown as BeforeRow[]).map((row) => [row.id, row]),
    );

    const nameOf = (row: BeforeRow | undefined): string | undefined =>
      typeof row?.payload?.product_name === 'string' ? row.payload.product_name : undefined;

    /*
     * `batch_id is null` in the write, not just in the report.
     *
     * A batch is decided as a unit on its own page, and the individual queue deliberately excludes those
     * rows. Guarding the UPDATE as well means a crafted POST naming a batch row cannot pick it off
     * outside the batch decision — the classification below then reports it as `in_batch`.
     */
    const { data: updated, error: writeError } = await supabase
      .from('product_proposals')
      .update({
        status: approving ? 'approved' : 'rejected',
        reviewer_note: input.note ?? null,
        reviewed_by: gate.actor.id,
        reviewed_at: new Date().toISOString(),
      })
      .in('id', input.proposalIds)
      .in('status', DECIDABLE)
      .is('batch_id', null)
      .select('id');

    if (writeError) {
      logger.error('decideProposalsBulk write failed', { cause: writeError.message });
      return fail<ProposalErrorKey, BulkProposalDecision>('merchant.proposals.errors.generic');
    }

    const decidedIds = ((updated ?? []) as { id: string }[]).map((row) => row.id);

    const skipped = classifySkips({
      requested: input.proposalIds,
      decided: decidedIds,
      seen: new Map(
        [...before].map(
          ([id, row]) =>
            [
              id,
              { status: row.status, label: nameOf(row), inBatch: row.batch_id !== null },
            ] as const,
        ),
      ),
      decidable: DECIDABLE,
    });

    const bulkId = crypto.randomUUID();
    await auditMany(
      approving ? 'proposal.approved' : 'proposal.rejected',
      'product_proposal',
      decidedIds.map((id) => ({
        entityId: id,
        before: { status: before.get(id)?.status ?? null },
        after: {
          status: approving ? 'approved' : 'rejected',
          merchant_id: before.get(id)?.merchant_id ?? null,
          note: input.note ?? null,
          bulk: true,
          bulk_id: bulkId,
        } as unknown as Json,
      })),
    );

    /*
     * One email per merchant. The digest names the first proposal; the portal lists the rest.
     */
    const byMerchant = new Map<string, string[]>();
    for (const id of decidedIds) {
      const merchantId = before.get(id)?.merchant_id;
      if (!merchantId) continue;
      byMerchant.set(merchantId, [...(byMerchant.get(merchantId) ?? []), id]);
    }

    let merchantsEmailed = 0;
    let emailsFailed = 0;
    for (const [merchantId, ids] of byMerchant) {
      const first = ids[0];
      try {
        await sendProposalDecided(
          merchantId,
          nameOf(first === undefined ? undefined : before.get(first)) ?? '',
          approving ? 'approved' : 'rejected',
          input.note ?? null,
        );
        merchantsEmailed += 1;
      } catch (error) {
        emailsFailed += 1;
        logger.error('decideProposalsBulk email failed', { merchantId, ...describeError(error) });
      }
    }

    /*
     * The deferred tail, scoped to the rows just decided.
     *
     * Emails ran first on purpose: cheap-and-irreversible before expensive-and-resumable, so a request
     * killed inside the storage loop has still recorded and announced every decision. Both sweeps are
     * idempotent over derived queues, so the cron finishing the job later is harmless.
     */
    let promoted = 0;
    let awaiting = 0;
    let imagesFailed = 0;
    let offersMinted = 0;

    if (approving && decidedIds.length > 0) {
      const swept = await sweepApprovedProposals({ limit: INLINE_PROMOTIONS, ids: decidedIds });
      promoted = swept.promoted;
      awaiting = swept.remaining;
      imagesFailed = swept.failed;

      const minted = await sweepProposalOffers(INLINE_PROMOTIONS, decidedIds);
      offersMinted = minted.minted;
    }

    /*
     * The page, not the layout.
     *
     * The single decision uses `'layout'` because a row rejected from inside a batch table is decided by
     * that action, and the child route `/admin/merchants/proposals/[batchId]` would otherwise keep serving
     * the row as pending. This action cannot touch a batch row at all — the UPDATE carries
     * `.is('batch_id', null)` — so there is no child route to invalidate, and a layout-wide revalidation
     * here only widens what gets thrown away while the reviewer is reading a report about it.
     */
    revalidatePath('/admin/merchants/proposals');
    revalidatePath('/merchant/proposals');
    if (promoted > 0) revalidatePath('/admin/products');

    return ok<BulkProposalDecision>({
      decision: input.decision,
      requested: input.proposalIds.length,
      decided: decidedIds.length,
      skipped,
      merchants: byMerchant.size,
      merchantsEmailed,
      emailsFailed,
      promoted,
      awaiting,
      offersMinted,
      imagesFailed,
    });
  } catch (error) {
    logger.error('decideProposalsBulk threw', describeError(error));
    return fail<ProposalErrorKey, BulkProposalDecision>('merchant.proposals.errors.generic');
  }
}
