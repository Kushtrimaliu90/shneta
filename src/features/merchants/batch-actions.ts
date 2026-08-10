'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { getMyMerchant } from '@/features/merchants/queries';
import { parseProposalCsv } from '@/features/merchants/proposal-csv';
import { sweepApprovedProposals } from '@/features/merchants/proposal-sweep';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §9.1 — a pasted catalogue, its photographs, and the reviewer's answer to the whole thing.
 *
 * ── The three actions and why they are separate ──
 *
 * `submitProposalBatch` creates the rows. `attachBatchImages` adds photographs to rows that already exist,
 * because the bytes go from the browser and the filename is what says which row they belong to. `decideBatch`
 * is the reviewer's, behind `offers.review`.
 *
 * Splitting submit from attach is not a UX preference: a server action's body is capped at 1 MB, and a
 * merchant sending 200 rows and 300 phone photographs in one request would fail on the photographs and lose
 * the rows with them.
 */

export type BatchErrorKey =
  | 'merchant.batches.errors.generic'
  | 'merchant.batches.errors.invalid'
  | 'merchant.batches.errors.notMerchant'
  | 'merchant.batches.errors.empty'
  | 'merchant.batches.errors.noHeader'
  | 'merchant.batches.errors.tooMany'
  | 'merchant.batches.errors.tooManyOpen'
  | 'admin.errors.forbidden';

export interface BatchReport {
  batchId: string | null;
  created: number;
  skipped: { name: string; reason: string }[];
  /** Rows this parser could not read at all, with line numbers matching the spreadsheet. */
  malformed: { line: number; reason: string }[];
}

export type BatchState = ActionResult<BatchReport, BatchErrorKey> | null;

function no(error: BatchErrorKey): BatchState {
  return fail<BatchErrorKey, BatchReport>(error);
}

/**
 * Creates a batch from a pasted sheet.
 *
 * The caps live in SQL (200 rows, 3 open batches) because they are the reason batch rows are exempt from the
 * twenty-open cap on individual proposals, and a limit enforced only in an action is a limit a future caller
 * forgets. Here they are turned into messages a merchant can act on.
 */
export async function submitProposalBatch(
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') return no('merchant.batches.errors.notMerchant');

  const text = String(formData.get('csv') ?? '');
  if (text.trim().length === 0) return no('merchant.batches.errors.empty');

  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, 2000);

  const parsed = parseProposalCsv(text);
  if (parsed.kind === 'no_header') return no('merchant.batches.errors.noHeader');
  if (parsed.rows.length === 0 && parsed.malformed.length === 0) {
    return no('merchant.batches.errors.empty');
  }
  if (parsed.rows.length > 200) return no('merchant.batches.errors.tooMany');

  /*
   * Every row was unreadable, so there is nothing to send.
   *
   * Reported as a successful parse with no batch rather than as an error, because the malformed list *is*
   * the answer the merchant needs — twelve line numbers and why each failed.
   */
  if (parsed.rows.length === 0) {
    return ok({ batchId: null, created: 0, skipped: [], malformed: parsed.malformed });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('merchant_bulk_create_proposals', {
      p_merchant_id: merchant.id,
      p_rows: parsed.rows as unknown as Json,
      p_note: note || undefined,
    });

    if (error) {
      if (error.message.includes('TOO_MANY_OPEN_BATCHES')) {
        return no('merchant.batches.errors.tooManyOpen');
      }
      if (error.message.includes('TOO_MANY_ROWS')) return no('merchant.batches.errors.tooMany');
      if (error.message.includes('NO_ROWS')) return no('merchant.batches.errors.empty');
      logger.error('submitProposalBatch failed', { cause: error.message });
      return no('merchant.batches.errors.generic');
    }

    const result = (data ?? {}) as {
      batch_id?: string | null;
      created?: number;
      skipped?: { name: string; reason: string }[];
    };

    revalidatePath('/merchant/proposals');
    /*
     * The page the merchant is standing on.
     *
     * `/merchant/proposals/bulk` is where the sheet is submitted AND where the resulting batches are
     * listed — including the link to attach photographs. Without this the merchant sent a catalogue,
     * stayed on the page, and saw nothing appear, so the photo step was unreachable even for somebody
     * already in the right place. Found while writing the journey test for the reported bug.
     */
    revalidatePath('/merchant/proposals/bulk');
    revalidatePath('/admin/merchants/proposals');

    return ok({
      batchId: result.batch_id ?? null,
      created: result.created ?? 0,
      skipped: result.skipped ?? [],
      malformed: parsed.malformed,
    });
  } catch (error) {
    logger.error('submitProposalBatch threw', describeError(error));
    return no('merchant.batches.errors.generic');
  }
}

const assignmentSchema = z.object({
  batchId: z.string().uuid(),
  assignments: z
    .array(z.object({ proposalId: z.string().uuid(), path: z.string().min(1).max(400) }))
    .min(1)
    .max(600),
});

export type AttachState = ActionResult<{ attached: number }, BatchErrorKey> | null;

/**
 * Attaches uploaded photographs to the rows the merchant matched them to.
 *
 * ── The paths are verified, not trusted ──
 *
 * The browser uploaded the bytes and tells us where it put them, exactly as the single-proposal uploader
 * does (§9). A path outside this merchant's own folder is refused here: the storage policy already stops
 * the *upload*, but nothing stops a crafted submission naming somebody else's object, and an approved row
 * copies its images onto a public product page.
 *
 * The row is verified too. `proposalId` arrives from the browser, so each one is checked to belong to this
 * batch — and the batch to this merchant, which RLS enforces on the read.
 */
export async function attachBatchImages(input: unknown): Promise<AttachState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved')
    return fail('merchant.batches.errors.notMerchant');

  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return fail('merchant.batches.errors.invalid');
  const { batchId, assignments } = parsed.data;

  const prefix = `proposals/${merchant.id}/`;
  for (const assignment of assignments) {
    if (
      !assignment.path.startsWith(prefix) ||
      assignment.path.length <= prefix.length ||
      assignment.path.includes('..') ||
      assignment.path.slice(prefix.length).includes('/')
    ) {
      logger.info('batch image path rejected', { merchantId: merchant.id });
      return fail('merchant.batches.errors.invalid');
    }
  }

  try {
    const supabase = await createClient();

    /*
     * Through an RPC, not an UPDATE (docs/13 §X15).
     *
     * `p_own_update` on `product_proposals` admits a merchant only for `status = 'needs_info'` — a pending
     * proposal must not change under the reviewer reading it — so writing the payload directly matched zero
     * rows and PostgREST called that success. The first version of this action counted what it *meant* to
     * write and reported three photographs attached while attaching none.
     *
     * `merchant_attach_batch_images` permits exactly one change, appending paths, and returns what it
     * actually wrote. It re-checks the folder prefix and the row's batch as well: this check produces the
     * readable error, the SQL one makes the rule true for every caller.
     */
    const { data, error } = await supabase.rpc('merchant_attach_batch_images', {
      p_batch_id: batchId,
      p_assignments: assignments.map((assignment) => ({
        proposal_id: assignment.proposalId,
        path: assignment.path,
      })) as unknown as Json,
    });

    if (error) {
      logger.error('attachBatchImages failed', { cause: error.message });
      return fail('merchant.batches.errors.generic');
    }

    const result = (data ?? {}) as { attached?: number; rejected?: number };
    if ((result.rejected ?? 0) > 0) {
      // Not an error the merchant sees — a path the SQL refused is a bug or a probe, and either is worth a log.
      logger.info('batch image assignments rejected', {
        batchId,
        rejected: result.rejected ?? 0,
      });
    }

    revalidatePath(`/merchant/proposals/${batchId}`);
    // The list shows per-batch image counts, so attaching changes it too.
    revalidatePath('/merchant/proposals/bulk');
    revalidatePath(`/admin/merchants/proposals/${batchId}`);
    return ok({ attached: result.attached ?? 0 });
  } catch (error) {
    logger.error('attachBatchImages threw', describeError(error));
    return fail('merchant.batches.errors.generic');
  }
}

const decisionSchema = z.object({
  batchId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});

export interface BatchDecision {
  decided: number;
  /** Draft products created before this request handed the rest to the cron. */
  promoted: number;
  awaiting: number;
}

/**
 * How many rows this request promotes before handing the rest to the cron.
 *
 * Five, from measurement rather than taste: one row with one photograph takes about a second — an RPC, a
 * download from the private bucket, an upload to the public one and an insert — and a row may carry six
 * images. Five is therefore a worst case of roughly twenty seconds, inside the sixty the page declares and
 * inside Vercel's default even if that declaration is ever dropped.
 *
 * The point of promoting *any* inline is that a reviewer who approves sixty products should see products
 * appear rather than a promise. The point of stopping at five is that the alternative — a reviewer watching a
 * request die at the platform's timeout after the decision has already been committed — reads as a broken
 * feature even though every row was recorded.
 */
const INLINE_PROMOTIONS = 5;

export type DecideBatchState = ActionResult<BatchDecision, BatchErrorKey> | null;

/**
 * The reviewer's answer to a whole batch.
 *
 * ── Why this promotes only a handful and leaves the rest ──
 *
 * Approving 200 rows means 200 draft products and every photograph copied between storage buckets — many
 * hundreds of round trips, well past what a request should hold open. So the decision is recorded for every
 * row, a bounded first slice is promoted here so the reviewer sees the feature work, and the housekeeping
 * cron drains the remainder from `proposals_awaiting_promotion`.
 *
 * That split is why the queue is derived from `created_product_id is null` rather than kept in a column:
 * both drains are then idempotent, and neither has to know about the other.
 */
export async function decideBatch(
  _previous: DecideBatchState,
  formData: FormData,
): Promise<DecideBatchState> {
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return fail('admin.errors.forbidden');

  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail('merchant.batches.errors.invalid');
  const input = parsed.data;

  if (input.decision === 'reject' && (input.note ?? '').trim().length < 5) {
    return fail('merchant.batches.errors.invalid');
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('decide_proposal_batch', {
      p_batch_id: input.batchId,
      p_decision: input.decision,
      p_note: input.note ?? undefined,
    });

    if (error) {
      logger.error('decideBatch failed', { cause: error.message });
      return fail('merchant.batches.errors.invalid');
    }

    const result = (data ?? {}) as { decided?: number };
    const decided = result.decided ?? 0;

    let promoted = 0;
    let awaiting = 0;

    if (input.decision === 'approve') {
      const swept = await sweepApprovedProposals({
        limit: INLINE_PROMOTIONS,
        batchId: input.batchId,
      });
      promoted = swept.promoted;
      awaiting = swept.remaining;
    }

    await audit(`proposal_batch.${input.decision}`, 'proposal_batch', input.batchId, null, {
      decided,
      promoted,
      awaiting,
      note: input.note ?? null,
    } as unknown as Json);

    revalidatePath('/admin/merchants/proposals');
    revalidatePath(`/admin/merchants/proposals/${input.batchId}`);
    revalidatePath('/admin/products');
    revalidatePath('/merchant/proposals');

    return ok({ decided, promoted, awaiting });
  } catch (error) {
    logger.error('decideBatch threw', describeError(error));
    return fail('merchant.batches.errors.generic');
  }
}
