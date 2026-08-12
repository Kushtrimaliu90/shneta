import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { promoteProposal } from '@/features/merchants/proposal-promote';
import { createOfferFromProposal } from '@/features/merchants/proposal-offer';

/**
 * docs/16 §9.1 — draining the promotion queue.
 *
 * ── Why promotion is swept rather than done at approval ──
 *
 * Approving a 200-row batch means creating 200 draft products and copying every photograph from the private
 * proposals bucket to the public product one. That is many hundreds of storage round trips: far past what a
 * request should hold open, and a timeout halfway through would leave a reviewer unable to tell which rows
 * had landed.
 *
 * So approval records the decision, `decideBatch` promotes a bounded first slice so the reviewer sees it
 * work, and this drains the rest — called by the housekeeping cron and by nothing else on a schedule.
 *
 * ── The queue is derived, not stored ──
 *
 * `proposals_awaiting_promotion` is `status = 'approved' and created_product_id is null`. A row leaves by
 * being **done**, not by being marked, which is what makes overlapping drains harmless: two sweeps racing
 * on the same row both call an idempotent function, and the second gets `created: false`. There is no
 * "claimed" flag to leak when a run dies halfway.
 *
 * ── Why the service client ──
 *
 * The cron has no session, and `promote_proposal_to_draft` admits the service role or a product manager. It
 * is on the docs/02 §6 list for that reason. `decideBatch` calls this too, from a reviewer's session — the
 * client differs, the code does not, which is the point.
 */

export interface SweepResult {
  /** Rows that gained a draft product on this run. */
  promoted: number;
  /** Rows that failed, counted rather than thrown: one bad payload must not stop the queue. */
  failed: number;
  imagesCopied: number;
  /** Still waiting after this run, so a caller can say "the rest follow within the hour" honestly. */
  remaining: number;
}

const DEFAULT_LIMIT = 25;

export async function sweepApprovedProposals(options?: {
  limit?: number;
  batchId?: string;
  /**
   * Restrict the drain to specific rows.
   *
   * Added for the multi-select decision, which wants to promote a bounded slice **of the rows it just
   * decided** rather than whatever happens to be oldest globally. Without it a reviewer who approved five
   * proposals could watch the inline slice go to somebody else's month-old backlog and see `promoted: 0`
   * for their own work — true, but unreadable as feedback.
   *
   * `remaining` stays scoped the same way, so "12 of these rows are queued" counts these rows.
   */
  ids?: readonly string[];
}): Promise<SweepResult> {
  const limit = Math.max(1, Math.min(options?.limit ?? DEFAULT_LIMIT, 200));
  const admin = createAdminClient();

  const empty: SweepResult = { promoted: 0, failed: 0, imagesCopied: 0, remaining: 0 };

  // An explicit but empty id list means "nothing was decided", not "drain the queue".
  if (options?.ids && options.ids.length === 0) return empty;

  try {
    let query = admin.from('proposals_awaiting_promotion').select('id').limit(limit);
    if (options?.batchId) query = query.eq('batch_id', options.batchId);
    if (options?.ids) query = query.in('id', [...options.ids]);

    const { data, error } = await query;

    if (error) {
      logger.error('sweepApprovedProposals read failed', { cause: error.message });
      return empty;
    }

    const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
    let promoted = 0;
    let failed = 0;
    let imagesCopied = 0;

    /*
     * Sequential, deliberately. Each promotion downloads and re-uploads files; running twenty-five of those
     * concurrently against one storage bucket trades a slow sweep for a rate-limited one, and the sweep has
     * no deadline — the cron runs every night and the queue drains across runs if it has to.
     */
    for (const id of ids) {
      const result = await promoteProposal(id, { asService: true });
      if (!result) {
        failed += 1;
        continue;
      }
      promoted += 1;
      imagesCopied += result.imagesCopied;
    }

    const remaining = await countRemaining(options?.batchId, options?.ids);

    if (promoted > 0 || failed > 0) {
      logger.info('proposal promotion sweep', { promoted, failed, imagesCopied, remaining });
    }

    return { promoted, failed, imagesCopied, remaining };
  } catch (error) {
    logger.error('sweepApprovedProposals threw', describeError(error));
    return empty;
  }
}

async function countRemaining(batchId?: string, ids?: readonly string[]): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from('proposals_awaiting_promotion')
    .select('id', { count: 'exact', head: true });
  if (batchId) query = query.eq('batch_id', batchId);
  if (ids) query = query.in('id', [...ids]);

  const { count, error } = await query;
  if (error) {
    logger.error('countRemaining failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}

/**
 * docs/16 §9 — draining the *offer* queue, which is a second phase over the same rows.
 *
 * Promotion and offer-minting are separate queues because they fail differently. Promotion copies
 * photographs — many storage round trips, not transactional. This is one INSERT behind two CHECK
 * constraints. A malformed asking price must not be able to roll back a product that was fine, and it
 * must not sit at the head of the promotion queue failing every night.
 *
 * `proposals_awaiting_offer` is derived exactly like its sibling — approved, promoted, no
 * `offer_created_at`, under the retry cap — so a row leaves by being done and two overlapping sweeps
 * are harmless: the second call gets `created: false`.
 *
 * The retry cap is why the view filters `offer_attempts < 3`. A proposal whose terms can never satisfy
 * `merchant_offers` (an asking price of zero written straight into `payload` from psql, say) goes quiet
 * with the reason recorded in `offer_error`, rather than turning the nightly cron red forever.
 */
export interface OfferSweepResult {
  minted: number;
  failed: number;
  remaining: number;
}

export async function sweepProposalOffers(
  limit = 25,
  /** Scoped to specific rows for the same reason as its sibling above. */
  ids?: readonly string[],
): Promise<OfferSweepResult> {
  const empty: OfferSweepResult = { minted: 0, failed: 0, remaining: 0 };
  if (ids && ids.length === 0) return empty;
  try {
    const admin = createAdminClient();
    let query = admin.from('proposals_awaiting_offer').select('id').limit(limit);
    if (ids) query = query.in('id', [...ids]);
    const { data, error } = await query;

    if (error) {
      logger.error('sweepProposalOffers read failed', { cause: error.message });
      return empty;
    }

    const rowIds = ((data ?? []) as { id: string }[]).map((row) => row.id);
    let minted = 0;
    let failed = 0;

    /*
     * Higher limit than the promotion sweep (25 against 15) because the work is not comparable: one
     * INSERT against a photograph copy. Both numbers exist to fit inside the cron's shared 60 s.
     */
    for (const id of rowIds) {
      const result = await createOfferFromProposal(id);
      if (result?.created) minted += 1;
      else failed += 1;
    }

    // Scoped the same way the read was, so a caller asking about its own rows is told about its own rows.
    let remainingQuery = admin
      .from('proposals_awaiting_offer')
      .select('id', { count: 'exact', head: true });
    if (ids) remainingQuery = remainingQuery.in('id', [...ids]);
    const { count } = await remainingQuery;

    if (minted > 0 || failed > 0) {
      logger.info('proposal offer sweep', { minted, failed, remaining: count ?? 0 });
    }

    return { minted, failed, remaining: count ?? 0 };
  } catch (error) {
    logger.error('sweepProposalOffers threw', describeError(error));
    return empty;
  }
}
