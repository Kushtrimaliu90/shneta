import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { cn } from '@/lib/utils';
import {
  listProposals,
  proposalCounts,
  type ProposalStatus,
} from '@/features/merchants/proposal-queries';
import { countAwaitingPromotion, listBatches } from '@/features/merchants/batch-queries';
import { ProposalReview } from '@/features/merchants/components/proposal-review';

export const metadata: Metadata = { title: 'Product proposals' };
export const dynamic = 'force-dynamic';

const STATUSES: ProposalStatus[] = ['pending', 'needs_info', 'approved', 'rejected'];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/16 §4 — merchants asking for products BioCode does not list.
 *
 * Behind `offers.review`, the same capability as offers: both are catalogue judgements about whether a
 * third party may sell against a BioCode page.
 *
 * **Approving creates a draft product** carrying the merchant's photographs, name, brand and form (§9) —
 * invisible on the storefront, because publishing needs `compliance.approve`. So the price, the copy and the
 * compliance pass are all still ahead of it, on the catalogue screens.
 *
 * ── Two queues, deliberately ──
 *
 * The cards below are proposals sent **on their own**. A merchant that pasted a whole catalogue arrives as a
 * *batch* (§9.1) — one queue item with a table of rows, decided as a unit with per-row rejections — because
 * two hundred cards from one merchant would bury every individually-argued proposal underneath it.
 */
export default async function AdminProposalsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'offers.review')) redirect('/admin');

  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status: ProposalStatus = STATUSES.includes(raw as ProposalStatus)
    ? (raw as ProposalStatus)
    : 'pending';

  const [proposals, counts, batches, awaiting] = await Promise.all([
    listProposals(status),
    proposalCounts(),
    listBatches({ onlyPending: true }),
    countAwaitingPromotion(),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Product proposals</h1>
        <p className="mt-1 text-sm text-ink-600">
          A merchant holding stock of something BioCode does not list. Approving creates a{' '}
          <strong>draft</strong> product with the merchant&rsquo;s photographs attached — set its price and
          copy on{' '}
          <Link href="/admin/products" className="underline">
            the catalogue screens
          </Link>
          , then send it for compliance. Nothing here reaches the storefront until compliance publishes it.
        </p>
      </header>

      {/*
        Pasted catalogues, above the individual cards.

        A batch is the bigger commitment and the slower read, so it goes first — and the awaiting-promotion
        count is here rather than buried on a batch page because it is the one number that says whether the
        cron is keeping up. "60 approved" and "60 drafts exist" are different facts (§9.1).
      */}
      {(batches.length > 0 || awaiting > 0) && (
        <section aria-labelledby="batches" className="flex flex-col gap-3">
          <h2 id="batches" className="font-display text-lg font-semibold text-forest-900">
            Pasted catalogues
          </h2>

          {awaiting > 0 && (
            <p className="rounded-md border border-forest-500/40 bg-forest-50/50 p-3 text-sm text-ink-900">
              <span data-numeric>{awaiting}</span> approved row(s) are still waiting for their draft
              product. The nightly job creates 25 at a time; approving a batch creates the first few
              immediately.
            </p>
          )}

          {batches.length === 0 ? (
            <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
              No catalogues waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {batches.map((batch) => (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-4"
                >
                  <div>
                    <Link
                      href={`/admin/merchants/proposals/${batch.id}`}
                      className="font-medium text-forest-800 underline"
                    >
                      {batch.merchantName ?? 'Merchant'} — {batch.rowCount} row(s)
                    </Link>
                    <p className="text-[13px] text-ink-500">
                      sent {batch.createdAt.slice(0, 10)}
                      {batch.note && ` · ${batch.note.slice(0, 80)}`}
                    </p>
                  </div>
                  <Link
                    href={`/admin/merchants/proposals/${batch.id}`}
                    className="inline-flex min-h-8 items-center rounded-sm border border-line-strong px-2.5 text-xs text-ink-900 hover:bg-forest-50"
                  >
                    Review the table
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <h2 className="font-display text-lg font-semibold text-forest-900">
        Proposals sent on their own
      </h2>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {STATUSES.map((entry) => (
          <Link
            key={entry}
            href={`/admin/merchants/proposals?status=${entry}`}
            aria-current={entry === status ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors',
              entry === status
                ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                : 'border-line-strong text-ink-600 hover:bg-forest-50',
            )}
          >
            {entry.replace('_', ' ')}
            <span className="font-ui font-semibold" data-numeric>
              {counts[entry]}
            </span>
          </Link>
        ))}
      </nav>

      {proposals.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-ink-600">
          {status === 'pending'
            ? 'Nothing waiting. Merchants propose products from their portal.'
            : `No ${status.replace('_', ' ')} proposals.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <ProposalReview proposal={proposal} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
