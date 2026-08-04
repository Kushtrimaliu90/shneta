import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { promoteProposal } from '@/features/merchants/proposal-promote';

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
}): Promise<SweepResult> {
  const limit = Math.max(1, Math.min(options?.limit ?? DEFAULT_LIMIT, 200));
  const admin = createAdminClient();

  const empty: SweepResult = { promoted: 0, failed: 0, imagesCopied: 0, remaining: 0 };

  try {
    let query = admin.from('proposals_awaiting_promotion').select('id').limit(limit);
    if (options?.batchId) query = query.eq('batch_id', options.batchId);

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

    const remaining = await countRemaining(options?.batchId);

    if (promoted > 0 || failed > 0) {
      logger.info('proposal promotion sweep', { promoted, failed, imagesCopied, remaining });
    }

    return { promoted, failed, imagesCopied, remaining };
  } catch (error) {
    logger.error('sweepApprovedProposals threw', describeError(error));
    return empty;
  }
}

async function countRemaining(batchId?: string): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from('proposals_awaiting_promotion')
    .select('id', { count: 'exact', head: true });
  if (batchId) query = query.eq('batch_id', batchId);

  const { count, error } = await query;
  if (error) {
    logger.error('countRemaining failed', { cause: error.message });
    return 0;
  }
  return count ?? 0;
}
