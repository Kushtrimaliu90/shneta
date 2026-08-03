import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { cn } from '@/lib/utils';
import type { OfferStatus } from '@/features/merchants/queries';
import {
  listOffersForReview,
  offerCountsForReview,
} from '@/features/merchants/offer-admin-queries';
import { OfferReview } from '@/features/merchants/components/offer-review';

export const metadata: Metadata = { title: 'Merchant offers' };

const STATUSES: OfferStatus[] = ['pending_review', 'approved', 'paused', 'rejected', 'draft'];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/16 §5, §11 — the offer review queue.
 *
 * `offers.review` rather than `merchants.manage`, and the split is the point: approving a *merchant*
 * sets a commission and a shipping arrangement, which is commercial and admin-only, while approving an
 * *offer* is a judgement about whether a third party may sell against a BioCode product page — which
 * is a catalogue decision and belongs to whoever already owns the catalogue (docs/01 §3).
 *
 * Opens on `pending_review` because that is the only status with work in it.
 */
export default async function AdminOffersPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'offers.review')) redirect('/admin');

  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status: OfferStatus = STATUSES.includes(raw as OfferStatus)
    ? (raw as OfferStatus)
    : 'pending_review';

  const [offers, counts] = await Promise.all([
    listOffersForReview(status),
    offerCountsForReview(),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Merchant offers</h1>
        <p className="mt-1 text-sm text-ink-600">
          A merchant offering stock against a BioCode product page. Approving one makes it eligible
          for the buy box; BioCode&rsquo;s own stock still wins wherever it exists.
        </p>
      </header>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {STATUSES.map((entry) => (
          <Link
            key={entry}
            href={`/admin/merchants/offers?status=${entry}`}
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

      {offers.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-ink-600">
          {status === 'pending_review'
            ? 'Nothing waiting. Merchants submit offers from their portal.'
            : `No ${status.replace('_', ' ')} offers.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {offers.map((offer) => (
            <li key={offer.id}>
              <OfferReview offer={offer} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
