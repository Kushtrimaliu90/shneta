import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import {
  listMerchants,
  merchantCounts,
  type MerchantStatus,
} from '@/features/merchants/admin-queries';
import { ApplicationReview } from '@/features/merchants/components/application-review';

export const metadata: Metadata = { title: 'Merchant applications' };

const STATUSES: MerchantStatus[] = ['pending', 'approved', 'rejected', 'suspended'];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/16 §4, §11 — the application queue.
 *
 * `merchants.view` opens the screen so support and the product manager can see who sells what;
 * `merchants.manage` is admin-only and is what the approve, reject and request-info actions check.
 * A reviewer without it sees the queue and no buttons, which is the right shape: the decision sets a
 * commission and a shipping arrangement, and that is a commercial call rather than an operational one.
 */
export default async function MerchantApplicationsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'merchants.view')) redirect('/admin');

  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status: MerchantStatus = STATUSES.includes(raw as MerchantStatus)
    ? (raw as MerchantStatus)
    : 'pending';

  const [merchants, counts] = await Promise.all([listMerchants(status), merchantCounts()]);

  /*
   * The marketplace defaults, so the approve form opens on the numbers somebody chose rather than on
   * a hard-coded 15. If the setting moves, the next approval follows it.
   */
  const supabase = await createClient();
  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'marketplace')
    .maybeSingle();

  const config = (setting as { value: Record<string, unknown> } | null)?.value ?? {};
  const defaultCommission =
    typeof config.default_commission_pct === 'number' ? config.default_commission_pct : 15;
  const defaultShipping =
    config.shipping_borne_by === 'merchant' || config.shipping_borne_by === 'customer'
      ? config.shipping_borne_by
      : 'biocode';

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-forest-900">Merchants</h1>
        <p className="mt-1 text-sm text-ink-600">
          Applications and approved sellers. Approving one sets its commission and shipping
          arrangement — both apply from its first order.
        </p>
      </header>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {STATUSES.map((entry) => (
          <Link
            key={entry}
            href={`/admin/merchants/applications?status=${entry}`}
            aria-current={entry === status ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs capitalize transition-colors',
              entry === status
                ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                : 'border-line-strong text-ink-600 hover:bg-forest-50',
            )}
          >
            {entry}
            <span className="font-ui font-semibold" data-numeric>
              {counts[entry]}
            </span>
          </Link>
        ))}
      </nav>

      {merchants.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-ink-600">
          {status === 'pending'
            ? 'No applications waiting. New ones arrive from /merchant/apply.'
            : `No ${status} merchants.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {merchants.map((merchant) => (
            <li key={merchant.id}>
              <ApplicationReview
                merchant={merchant}
                defaultCommission={defaultCommission}
                defaultShipping={defaultShipping}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
