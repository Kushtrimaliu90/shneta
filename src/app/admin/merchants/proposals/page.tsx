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
 * **Approving records a decision; it does not create a product.** A product needs a slug, SEO copy,
 * ingredients, images and a compliance pass, and that lives on the catalogue screens. Anything else would
 * be merchant-created listings with a delay, which is what §1 exists to prevent — so the flow is: approve
 * here with a note, create the product there, and the merchant makes an offer on it.
 */
export default async function AdminProposalsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'offers.review')) redirect('/admin');

  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status: ProposalStatus = STATUSES.includes(raw as ProposalStatus)
    ? (raw as ProposalStatus)
    : 'pending';

  const [proposals, counts] = await Promise.all([listProposals(status), proposalCounts()]);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Product proposals</h1>
        <p className="mt-1 text-sm text-ink-600">
          A merchant holding stock of something BioCode does not list. Approving means &ldquo;yes, we will
          list this&rdquo; — the product itself is created on{' '}
          <Link href="/admin/products" className="underline">
            the catalogue screens
          </Link>
          , and the note is where you tell the merchant what you made.
        </p>
      </header>

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
