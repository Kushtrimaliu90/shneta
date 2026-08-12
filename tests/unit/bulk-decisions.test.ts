import { describe, expect, it } from 'vitest';
import {
  OFFER_BULK_MAX,
  PROPOSAL_BULK_MAX,
  SKIP_REASONS,
  bulkHeadline,
  classifySkips,
  dedupeIds,
  proposalFollowUp,
  type BulkProposalDecision,
  type BulkSkipReason,
} from '@/features/merchants/decisions';
import { offerBulkDecisionSchema } from '@/features/merchants/offer-schemas';
import { proposalBulkDecisionSchema } from '@/features/merchants/proposal-schemas';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('dedupeIds', () => {
  it('collapses a repeated id before it can spend cap budget', () => {
    /*
     * A doubled checkbox or a duplicated hidden input would otherwise inflate `requested`, so the report
     * would claim more rows than the reviewer picked.
     */
    expect(dedupeIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('drops empty values rather than sending them to the schema', () => {
    expect(dedupeIds(['a', '', 'b'])).toEqual(['a', 'b']);
  });
});

describe('the schemas', () => {
  it('refuse an empty selection', () => {
    /*
     * `.in('id', [])` matches nothing and PostgREST reports that as zero rows — indistinguishable from
     * "every row had already moved", which would make the report lie. The schema stops it earlier.
     */
    expect(
      offerBulkDecisionSchema.safeParse({ offerIds: [], decision: 'approve' }).success,
    ).toBe(false);
  });

  it('refuse more than the cap', () => {
    const tooMany = Array.from({ length: OFFER_BULK_MAX + 1 }, (_, i) => UUID(i));
    expect(
      offerBulkDecisionSchema.safeParse({ offerIds: tooMany, decision: 'approve' }).success,
    ).toBe(false);

    const atCap = tooMany.slice(0, OFFER_BULK_MAX);
    expect(
      offerBulkDecisionSchema.safeParse({ offerIds: atCap, decision: 'approve' }).success,
    ).toBe(true);
  });

  it('refuse needs_info in bulk, on both queues', () => {
    // One question asked of twenty merchants is not a question — it stays a per-card decision.
    expect(
      proposalBulkDecisionSchema.safeParse({
        proposalIds: [UUID(1)],
        decision: 'needs_info',
      }).success,
    ).toBe(false);
  });

  it('refuse a non-uuid id', () => {
    expect(
      offerBulkDecisionSchema.safeParse({ offerIds: ['not-a-uuid'], decision: 'approve' }).success,
    ).toBe(false);
  });

  it('cap the proposal queue lower than the offer queue', () => {
    // Each approved proposal carries a deferred draft-product tail; an offer carries an email.
    expect(PROPOSAL_BULK_MAX).toBeLessThan(OFFER_BULK_MAX);
  });
});

describe('classifySkips', () => {
  const decidable = ['pending_review', 'paused', 'draft'];

  it('reports nothing when everything was decided', () => {
    expect(
      classifySkips({
        requested: ['a', 'b'],
        decided: ['a', 'b'],
        seen: new Map([
          ['a', { status: 'pending_review' }],
          ['b', { status: 'pending_review' }],
        ]),
        decidable,
      }),
    ).toEqual([]);
  });

  it('calls a settled row already_decided', () => {
    const [skip] = classifySkips({
      requested: ['a'],
      decided: [],
      seen: new Map([['a', { status: 'approved', label: 'SKU-1' }]]),
      decidable,
    });
    expect(skip).toEqual({ id: 'a', label: 'SKU-1', reason: 'already_decided' });
  });

  it('distinguishes a row that is simply not in a decidable state', () => {
    const [skip] = classifySkips({
      requested: ['a'],
      decided: [],
      seen: new Map([['a', { status: 'archived', label: 'SKU-1' }]]),
      decidable,
    });
    expect(skip?.reason).toBe<BulkSkipReason>('not_pending_review');
  });

  it('calls a row the pre-read never saw not_found', () => {
    // Which also covers "invisible to this role under RLS" — the same fact from here.
    const [skip] = classifySkips({
      requested: ['ghost'],
      decided: [],
      seen: new Map(),
      decidable,
    });
    expect(skip).toEqual({ id: 'ghost', reason: 'not_found' });
  });

  it('routes a batch row to the batch page', () => {
    const [skip] = classifySkips({
      requested: ['a'],
      decided: [],
      seen: new Map([['a', { status: 'pending', label: 'Magnesium', inBatch: true }]]),
      decidable: ['pending', 'needs_info'],
    });
    expect(skip?.reason).toBe<BulkSkipReason>('in_batch');
  });

  it('reports a row that was decidable but lost the race as already_decided', () => {
    /*
     * Present, decidable, not in a batch, and still absent from the UPDATE's result: the row moved
     * between the pre-read and the write. The UPDATE's own status guard is the authority, and
     * "somebody else got there first" is the truthful reading.
     */
    const [skip] = classifySkips({
      requested: ['a'],
      decided: [],
      seen: new Map([['a', { status: 'pending_review', label: 'SKU-1' }]]),
      decidable,
    });
    expect(skip?.reason).toBe<BulkSkipReason>('already_decided');
  });

  it('has a sentence for every reason', () => {
    // A missing sentence would render as blank next to a row the operator has to act on.
    const reasons: BulkSkipReason[] = [
      'already_decided',
      'not_pending_review',
      'not_found',
      'in_batch',
    ];
    for (const reason of reasons) expect(SKIP_REASONS[reason]).toMatch(/\S/);
  });
});

describe('bulkHeadline', () => {
  const base = {
    decision: 'approve' as const,
    requested: 20,
    decided: 17,
    skipped: [],
    merchants: 4,
    merchantsEmailed: 4,
    emailsFailed: 0,
  };

  it('leads with the count against what was asked for', () => {
    // "17 approved" hides that three were not. "17 of 20" is the fact that decides whether to look.
    expect(bulkHeadline(base)).toBe('17 of 20 approved. 4 merchants emailed.');
  });

  it('says nothing was done rather than reporting zero of twenty', () => {
    expect(bulkHeadline({ ...base, decided: 0, merchantsEmailed: 0 })).toBe(
      'Nothing was approved.',
    );
  });

  it('uses the right verb for a rejection', () => {
    expect(bulkHeadline({ ...base, decision: 'reject' })).toContain('rejected');
  });

  it('reads as English at one', () => {
    expect(
      bulkHeadline({ ...base, requested: 1, decided: 1, merchants: 1, merchantsEmailed: 1 }),
    ).toBe('1 of 1 approved. 1 merchant emailed.');
  });

  it('says a failed email did not undo the decision', () => {
    const line = bulkHeadline({ ...base, merchantsEmailed: 3, emailsFailed: 1 });
    expect(line).toContain('1 merchant could not be emailed');
    expect(line).toContain('the decision stands');
  });

  it('omits the email clause when nothing was emailed', () => {
    expect(bulkHeadline({ ...base, merchantsEmailed: 0 })).toBe('17 of 20 approved.');
  });
});

describe('proposalFollowUp', () => {
  const base: BulkProposalDecision = {
    decision: 'approve',
    requested: 20,
    decided: 17,
    skipped: [],
    merchants: 4,
    merchantsEmailed: 4,
    emailsFailed: 0,
    promoted: 5,
    awaiting: 12,
    offersMinted: 5,
    imagesFailed: 0,
  };

  it('states the nightly rate as a queue-wide rate, not a promise about these rows', () => {
    /*
     * The cron drains globally and oldest-first, so somebody else's backlog can sit ahead of these.
     * "15 a night across the whole queue" is true; "the rest by morning" would be a guess.
     */
    const lines = proposalFollowUp(base, 15);
    expect(lines.join(' ')).toContain('15 a night across the whole queue');
    expect(lines.join(' ')).not.toMatch(/by morning|overnight/i);
  });

  it('reports drafts and minted offers together', () => {
    expect(proposalFollowUp(base, 15)[0]).toBe('5 draft products created and 5 offers minted.');
  });

  it('omits the offer clause when none were minted', () => {
    expect(proposalFollowUp({ ...base, offersMinted: 0 }, 15)[0]).toBe('5 draft products created.');
  });

  it('says a failed photograph copy is terminal, because it is', () => {
    // `promoteProposal` skips the copy once the draft exists, and the row has left the queue.
    const lines = proposalFollowUp({ ...base, imagesFailed: 2 }, 15);
    expect(lines.join(' ')).toContain('not retried');
  });

  it('says nothing at all when there is nothing to add', () => {
    expect(
      proposalFollowUp({ ...base, promoted: 0, awaiting: 0, offersMinted: 0 }, 15),
    ).toEqual([]);
  });
});
