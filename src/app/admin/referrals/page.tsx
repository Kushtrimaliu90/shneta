import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { getLoyaltySettings } from '@/features/loyalty/queries';
import {
  getReferralLiability,
  listFraudSignals,
  listReferralEarnings,
  listReferralLinks,
  listReferralQueue,
} from '@/features/referrals/admin-queries';
import { isReferralProgrammeEnabled } from '@/features/referrals/queries';
import { ReferralsAdmin } from '@/features/referrals/components/referrals-admin';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = { title: 'Referrals' };

type Props = { searchParams: Promise<{ status?: string; q?: string }> };

/**
 * docs/17 §5 — the referral panel.
 *
 * Three capabilities on one screen. `referrals.view` opens it, `referrals.review` works the queue and
 * stops a link — the judgement support makes all day — and `referrals.manage` covers everything that
 * mints money: a link by hand, an extended clock, stopping every link a referrer holds.
 *
 * Unlike the customer page, this one shows amounts against named people, which is the whole point of
 * it: somebody has to be able to answer "why was this paid?". That asymmetry is why the capability is
 * staff-only rather than something a customer session could ever reach (docs/17 §0.2).
 */
export default async function AdminReferralsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'referrals.view')) redirect('/admin');

  const { status, q } = await searchParams;
  const canManage = can(profile?.role, 'referrals.manage');

  const loyalty = await getLoyaltySettings();

  const [enabled, queue, links, earnings, fraud, liability] = await Promise.all([
    isReferralProgrammeEnabled(),
    listReferralQueue(),
    listReferralLinks({ status, search: q }),
    listReferralEarnings(),
    listFraudSignals(),
    getReferralLiability(loyalty.pointValueCents),
  ]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Referrals</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-600">
        Customers invite customers. A referred customer has one referrer for ever, and for twelve
        months from approval the referrer earns {loyalty.earnRate === 1 ? '1' : loyalty.earnRate}% of
        their eligible spend in points — {100 / loyalty.pointValueCents} points to the euro.{' '}
        {canManage
          ? 'You can approve, stop, extend once, and link two accounts by hand.'
          : 'You can approve and stop links; extending and manual links are admin-only.'}
      </p>

      {!enabled && (
        <Alert tone="warning" className="mt-4">
          The programme is switched off in Settings → Referrals. Existing links keep their points and
          nothing new accrues.
        </Alert>
      )}

      <ReferralsAdmin
        queue={queue}
        links={links}
        earnings={earnings}
        fraud={fraud}
        liability={liability}
        pointValueCents={loyalty.pointValueCents}
        canManage={canManage}
      />
    </div>
  );
}
