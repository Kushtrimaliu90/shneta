/**
 * Deciding several offers or proposals at once — the pure half.
 *
 * No `'use server'` and no `server-only`: everything here is a type, a constant, or a function over
 * plain data, so the client bar can share the caps and the copy with the actions, and a unit test can
 * import it.
 *
 * ── The shape, and why it is not an RPC ──
 *
 * One guarded `UPDATE … .in('id', ids).in('status', decidable).select()` per queue. That is a single SQL
 * statement, so it is atomic, and its `RETURNING` list *is* the partial-failure report: whatever comes
 * back was decided, and whatever was asked for but did not come back was not. A stored procedure would
 * add a second copy of the status allowlist to drift out of step, and for offers it would move the write
 * into `security definer` — bypassing the very policy the single-offer path exists to exercise.
 *
 * `decide_proposal_batch` is an RPC only because a batch has a parent row to flip. An arbitrary list of
 * ids has no parent.
 */

/**
 * How many rows one click may decide.
 *
 * These are equal to the page size of each queue, which is the point: "select all shown" must never be
 * able to build a payload the schema then rejects.
 *
 * **Offers 25.** The binding cost is the one hop nobody here controls — one email per merchant, sent
 * sequentially. Twenty-five distinct merchants is twenty-five POSTs to Resend, and nothing in this
 * codebase throttles email (`RATE_LIMITS` has no entry for it). 25 is also already this codebase's word
 * for one bite of work: `DEFAULT_LIMIT` in the promotion sweep, and the housekeeping cron's offer sweep.
 *
 * **Proposals 20.** Each approval carries a deferred tail — a draft product and its copied photographs —
 * and 20 is `INLINE_PROMOTIONS` (5) plus one full nightly sweep (15). So the honest claim about a full
 * selection is "the tail is at most one night's sweep", and the copy below says exactly that rather than
 * promising everything by morning: the cron drains the queue globally, oldest first, so somebody else's
 * backlog can sit ahead of it.
 */
export const OFFER_BULK_MAX = 25;
export const PROPOSAL_BULK_MAX = 20;

/** Why a requested row was left alone. */
export type BulkSkipReason = 'already_decided' | 'not_pending_review' | 'not_found' | 'in_batch';

export interface BulkSkip {
  id: string;
  /** From the pre-read, when the row exists at all. */
  label?: string;
  reason: BulkSkipReason;
}

export interface BulkDecision {
  decision: 'approve' | 'reject';
  requested: number;
  decided: number;
  skipped: BulkSkip[];
  merchants: number;
  /**
   * Digests handed to the mailer without an error coming back.
   *
   * Deliberately not called `merchantsNotified`: this is an accepted send, not a delivered message, and
   * the copy below says "emailed" rather than "notified" for the same reason.
   */
  merchantsEmailed: number;
  emailsFailed: number;
}

export type BulkOfferDecision = BulkDecision;

export interface BulkProposalDecision extends BulkDecision {
  /** Draft products created inside this request — bounded by `INLINE_PROMOTIONS`. */
  promoted: number;
  /** Decided here but still waiting for a draft, from this selection only. */
  awaiting: number;
  offersMinted: number;
  imagesFailed: number;
}

/**
 * One sentence per reason, as a total record so a new reason without copy is a compile error.
 *
 * Written from the reviewer's point of view — "since this page loaded" — because every one of these
 * means the same thing operationally: the screen was out of date, and reloading will explain it.
 */
export const SKIP_REASONS: Record<BulkSkipReason, string> = {
  already_decided: 'Decided by someone else since this page loaded.',
  not_pending_review: 'No longer waiting for review; it is a draft or paused now.',
  not_found: 'No longer in the queue.',
  in_batch: 'Part of a pasted catalogue — decide it on the batch page.',
};

/**
 * Duplicate ids collapsed before validation.
 *
 * A repeated hidden input, or a double-submitted checkbox, would otherwise spend cap budget and inflate
 * `requested` so the report claimed more rows than the reviewer picked.
 */
export function dedupeIds(values: readonly FormDataEntryValue[]): string[] {
  return [...new Set(values.map((value) => String(value)))].filter((id) => id.length > 0);
}

/**
 * Which requested ids did not get decided, and why.
 *
 * Pure, and derived entirely from what the pre-read and the UPDATE already returned — so classification
 * costs no extra round trip. Absent from the pre-read covers both "deleted" and "invisible to this role
 * under RLS", which are the same fact from here: this session cannot act on it.
 */
export function classifySkips({
  requested,
  decided,
  seen,
  decidable,
}: {
  requested: readonly string[];
  decided: readonly string[];
  /** Every row the pre-read returned, by id. */
  seen: ReadonlyMap<string, { status: string; label?: string; inBatch?: boolean }>;
  /** The statuses the UPDATE was allowed to move. */
  decidable: readonly string[];
}): BulkSkip[] {
  const done = new Set(decided);

  return requested
    .filter((id) => !done.has(id))
    .map((id) => {
      const row = seen.get(id);
      if (!row) return { id, reason: 'not_found' as const };
      if (row.inBatch) return { id, label: row.label, reason: 'in_batch' as const };
      if (!decidable.includes(row.status)) {
        const settled = row.status === 'approved' || row.status === 'rejected';
        return {
          id,
          label: row.label,
          reason: settled ? ('already_decided' as const) : ('not_pending_review' as const),
        };
      }
      /*
       * Decidable, present, not in a batch, and still not decided. The UPDATE's own `.in('status', …)`
       * is the authority, so this is the race it exists to win — the row moved between the pre-read and
       * the write. `already_decided` is the truthful reading.
       */
      return { id, label: row.label, reason: 'already_decided' as const };
    });
}

/** `1 offer` / `2 offers`, so the sentences below read as English at either count. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The headline an operator reads.
 *
 * Leads with the count against what was asked for, because "17 of 20" is the fact that decides whether
 * they need to look further; a bare "17 approved" hides that three did not.
 */
export function bulkHeadline(report: BulkDecision): string {
  const verb = report.decision === 'approve' ? 'approved' : 'rejected';

  if (report.decided === 0) {
    return `Nothing was ${verb}.`;
  }

  const parts = [`${report.decided} of ${report.requested} ${verb}.`];
  if (report.merchantsEmailed > 0) {
    parts.push(`${plural(report.merchantsEmailed, 'merchant', 'merchants')} emailed.`);
  }
  if (report.emailsFailed > 0) {
    parts.push(
      `${plural(report.emailsFailed, 'merchant could not be emailed', 'merchants could not be emailed')} — the decision stands regardless.`,
    );
  }
  return parts.join(' ');
}

/**
 * The extra sentences a proposal decision needs.
 *
 * The nightly figure is stated as a rate over the whole queue rather than a promise about these rows,
 * because the cron drains `proposals_awaiting_promotion` globally and oldest-first. Saying "the rest by
 * morning" would be a guess about somebody else's backlog.
 */
export function proposalFollowUp(report: BulkProposalDecision, nightlyRate: number): string[] {
  const lines: string[] = [];

  if (report.promoted > 0) {
    lines.push(
      `${plural(report.promoted, 'draft product', 'draft products')} created${
        report.offersMinted > 0
          ? ` and ${plural(report.offersMinted, 'offer', 'offers')} minted`
          : ''
      }.`,
    );
  }

  if (report.awaiting > 0) {
    lines.push(
      `${report.awaiting} of these rows are queued for the nightly job, which creates ${nightlyRate} a night across the whole queue.`,
    );
  }

  if (report.imagesFailed > 0) {
    lines.push(
      `${plural(report.imagesFailed, 'photograph', 'photographs')} could not be copied — open those drafts and re-upload them. A failed copy is not retried.`,
    );
  }

  return lines;
}
