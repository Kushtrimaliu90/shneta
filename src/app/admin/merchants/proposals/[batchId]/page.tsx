import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { getBatch } from '@/features/merchants/batch-queries';
import { BatchReview } from '@/features/merchants/components/batch-review';

export const metadata: Metadata = { title: 'Proposed catalogue' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ batchId: string }> };

/**
 * docs/16 §9.1 — one pasted catalogue, decided as a unit.
 *
 * Behind `offers.review`, like every other proposal surface. The capability is re-checked here because a
 * page is reachable by URL, and again inside `decide_proposal_batch` so a future cron cannot route around
 * this screen (§10–11).
 */
export default async function AdminBatchPage({ params }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'offers.review')) redirect('/admin');

  const { batchId } = await params;
  const batch = await getBatch(batchId);
  if (!batch) notFound();

  return (
    <section className="flex flex-col gap-6">
      <Link href="/admin/merchants/proposals" className="text-[13px] text-forest-800 underline">
        ← All proposals
      </Link>
      <BatchReview batch={batch} />
    </section>
  );
}
