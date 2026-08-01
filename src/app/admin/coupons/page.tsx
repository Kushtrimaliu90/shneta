import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { CouponsAdmin } from '@/features/coupons/components/coupons-admin';
import { listCoupons } from '@/features/coupons/queries';

export const metadata: Metadata = { title: 'Coupons' };

/**
 * docs/06 §11 — coupons: admin creates, support reads.
 *
 * Two capabilities on one page rather than two pages. Support genuinely needs this list — the
 * question they get on the phone is "why did my code not work", and the answer is almost always
 * on this screen: inactive, expired, used up, or the basket is under the minimum. Hiding it from
 * them would just route that question to an admin.
 */
export default async function AdminCouponsPage() {
  const profile = await getProfile();

  if (!can(profile?.role, 'coupons.view')) redirect('/admin');

  const canManage = can(profile?.role, 'coupons.manage');
  const rows = await listCoupons();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Coupons</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-600">
        Discount codes and how often they have been used.{' '}
        {canManage
          ? 'Codes are never deleted — deactivate one instead, so the orders that used it still make sense.'
          : 'Only an admin can create or change them.'}
      </p>

      <CouponsAdmin rows={rows} canManage={canManage} />
    </div>
  );
}
