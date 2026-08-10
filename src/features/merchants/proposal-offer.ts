import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';

/**
 * docs/16 §9 — minting the merchant's offer from an approved proposal.
 *
 * ── Why this is a second call and not part of promotion ──
 *
 * Approval used to create a draft product and stop, leaving the merchant to find that product in the
 * offer picker and re-type stock, price, SKU and handling days it had already written into the
 * proposal. For a batch of two hundred that was two hundred forms after the approval — the reason the
 * flow read as two steps for one intention (owner, 2026-08-10).
 *
 * It stays separate from `promoteProposal` because the two fail in different ways.
 * `promote_proposal_to_draft` is followed by a storage copy per photograph: many round trips, not
 * transactional, counted and reported per file. This is one INSERT behind two CHECK constraints. Fused,
 * a malformed asking price would roll back a product that was fine, return the row to
 * `proposals_awaiting_promotion` with `created_product_id is null`, and — because the housekeeping cron
 * turns a push failure into an HTTP 500 — leave one poison row failing every night while holding a slot
 * at the head of a `limit(15)` queue.
 *
 * ── The offer is live on publication, and that is deliberate ──
 *
 * `create_offer_from_proposal` writes `status = 'approved'`, so the offer enters the buy box the moment
 * compliance publishes the product (owner decision, 2026-08-10). It is defensible because the reviewer
 * approving the proposal has just read those exact terms — the price, the stock and the handling promise
 * are the proposal.
 *
 * Nothing becomes purchasable early. `variant_buy_box` requires the product to be published as of
 * migration 79, which was previously true only because no caller happened to pass a draft variant id.
 */
export interface OfferMintResult {
  created: boolean;
  offerId: string | null;
  reason?: string;
}

export async function createOfferFromProposal(proposalId: string): Promise<OfferMintResult | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('create_offer_from_proposal', {
      p_proposal_id: proposalId,
    });

    if (error) {
      logger.error('create_offer_from_proposal failed', { proposalId, cause: error.message });
      return null;
    }

    const result = (data ?? {}) as { created?: boolean; offer_id?: string; reason?: string };
    return {
      created: result.created === true,
      offerId: result.offer_id ?? null,
      reason: result.reason,
    };
  } catch (error) {
    logger.error('createOfferFromProposal threw', { proposalId, ...describeError(error) });
    return null;
  }
}
