import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { periodToSettle } from '@/features/merchants/payout-period';
import { listPayouts, merchantsOwed } from '@/features/merchants/payout-queries';
import { PayoutAdmin } from '@/features/merchants/components/payout-admin';

export const metadata: Metadata = { title: 'Merchant payouts' };
export const dynamic = 'force-dynamic';

/**
 * docs/16 §8 — the money screen.
 *
 * `payouts.manage`, which docs/01 §3 gives to **admin alone**. Routing is operational and support can do
 * it; deciding what leaves BioCode's bank account for a third party is not, and the SQL functions
 * enforce the same thing independently so a script cannot route around this page.
 *
 * The period is prefilled with the fortnight that just closed, computed by the same pure function the
 * cron uses — so a manual run and an automatic one settle the same dates rather than two answers to the
 * same question.
 */
export default async function AdminPayoutsPage() {
  const profile = await getProfile();
  if (!can(profile?.role, 'payouts.manage')) redirect('/admin');

  const [payouts, owed] = await Promise.all([listPayouts(), merchantsOwed()]);
  const period = periodToSettle(new Date());

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Merchant payouts</h1>
        <p className="mt-1 text-sm text-ink-600">
          A merchant is owed for a fulfilment when it has been <strong>delivered</strong> — not when
          it shipped, because a parcel in transit can come back, and not when the order was paid,
          because a COD order is not paid until the courier hands the cash over.
        </p>
      </header>

      <PayoutAdmin
        payouts={payouts}
        owed={owed}
        defaultPeriod={{ start: period.start, end: period.end }}
      />
    </section>
  );
}
