import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { AlertTriangle, PackageX, Trophy, Truck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { buttonVariants } from '@/components/ui/button';
import {
  getMyMerchant,
  listMyOffers,
  myOfferCounts,
  myWinningOfferIds,
} from '@/features/merchants/queries';
import { myFulfilmentCounts } from '@/features/merchants/fulfilment-queries';
import { merchantBalance } from '@/features/merchants/payout-queries';
import { merchantScorecard } from '@/features/merchants/proposal-queries';
import { ScorecardPanel } from '@/features/merchants/components/scorecard-panel';

export const metadata: Metadata = { title: 'Portali i shitësit' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

/**
 * docs/16 §5 — the portal dashboard.
 *
 * It answers three questions in the order a merchant asks them: what needs doing, what am I earning,
 * and what are my terms. Nothing here is a chart. A merchant with eleven offers does not need a
 * sparkline; they need to know which two have run out.
 *
 * **Buy-box wins are the number that could not be faked.** An approved, in-stock offer still loses to
 * BioCode's own stock and to a cheaper rival (§1), so "approved" is not the same as "selling" — and a
 * portal that showed only the offer status would let a merchant believe it was live for weeks. It is
 * computed from `variant_buy_box`, the same function the storefront uses, so the two cannot disagree.
 */
export default async function MerchantDashboard({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations('merchant.portal');

  const [merchant, counts, offers, fulfilmentCounts] = await Promise.all([
    getMyMerchant(),
    myOfferCounts(),
    listMyOffers(),
    myFulfilmentCounts(),
  ]);

  const [balance, scorecard] = merchant
    ? await Promise.all([merchantBalance(merchant.id), merchantScorecard(merchant.id)])
    : [null, null];

  if (!merchant) return null;

  /*
   * Orders needing an answer come first on this screen, above stock.
   *
   * A merchant with an unanswered assignment and a low-stock offer has one problem with a deadline and
   * one without: the acceptance window is 24 hours in the terms, and a dashboard that listed them in
   * schema order would bury it.
   */
  const openOrders =
    fulfilmentCounts.assigned + fulfilmentCounts.accepted + fulfilmentCounts.packed;

  const winning = await myWinningOfferIds(offers);
  const live = offers.filter((offer) => offer.status === 'approved');

  /*
   * What the merchant would receive if one unit of every live offer sold. Not a forecast — a
   * statement about the terms — which is why it is labelled per unit rather than as revenue.
   */
  const dueIfEachSold = live.reduce((total, offer) => total + offer.merchantDueCents, 0);

  const needsAttention = [
    fulfilmentCounts.assigned > 0
      ? {
          key: 'orders' as const,
          count: fulfilmentCounts.assigned,
          href: '/merchant/orders',
          icon: Truck,
        }
      : null,
    counts.outOfStock > 0
      ? {
          key: 'outOfStock' as const,
          count: counts.outOfStock,
          href: '/merchant/offers?status=approved',
          icon: PackageX,
        }
      : null,
    counts.lowStock > 0
      ? {
          key: 'lowStock' as const,
          count: counts.lowStock,
          href: '/merchant/offers?status=approved',
          icon: AlertTriangle,
        }
      : null,
    counts.rejected > 0
      ? {
          key: 'rejected' as const,
          count: counts.rejected,
          href: '/merchant/offers?status=rejected',
          icon: AlertTriangle,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="today">
        <h2 id="today" className="sr-only">
          {t('dashboard.today')}
        </h2>

        {needsAttention.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-600">
            {merchant.status === 'approved' ? t('dashboard.allClear') : t('dashboard.nothingYet')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {needsAttention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm transition-colors hover:bg-warning/10"
                >
                  <item.icon className="size-4 shrink-0 text-warning" aria-hidden="true" />
                  <span className="text-ink-900">
                    {item.key === 'orders'
                      ? t('dashboard.attentionOrders', { count: item.count })
                      : t(`dashboard.attention.${item.key}`, { count: item.count })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="numbers" className="flex flex-col gap-3">
        <h2 id="numbers" className="font-display text-lg font-semibold text-forest-900">
          {t('dashboard.numbers')}
        </h2>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t('dashboard.openOrders')}
            value={String(openOrders)}
            hint={t('dashboard.openOrdersHint')}
          />
          <Stat label={t('dashboard.liveOffers')} value={String(counts.approved)} />
          <Stat
            label={t('dashboard.inBuyBox')}
            value={String(winning.size)}
            hint={t('dashboard.inBuyBoxHint')}
            icon={winning.size > 0}
          />
          <Stat label={t('dashboard.awaitingReview')} value={String(counts.pending_review)} />
          <Stat
            label={t('dashboard.balance')}
            value={formatPrice(balance?.balanceCents ?? 0, locale)}
            hint={t('dashboard.balanceHint')}
          />
          <Stat
            label={t('dashboard.duePerUnit')}
            value={formatPrice(dueIfEachSold, locale)}
            hint={t('dashboard.duePerUnitHint')}
          />
        </dl>
      </section>

      {scorecard && (
        <ScorecardPanel scorecard={scorecard} ratingAvg={merchant.ratingAvg} />
      )}

      <section aria-labelledby="terms" className="flex flex-col gap-3">
        <h2 id="terms" className="font-display text-lg font-semibold text-forest-900">
          {t('dashboard.terms')}
        </h2>

        <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-5 text-sm sm:grid-cols-2">
          <Row label={t('dashboard.commission')}>
            {merchant.commissionPct}%{' '}
            <span className="text-ink-600">· {t('dashboard.commissionBasis')}</span>
          </Row>
          <Row label={t('dashboard.shipping')}>
            {t(`dashboard.shippingBy.${merchant.shippingBorneBy ?? 'default'}`)}
          </Row>
          <Row label={t('dashboard.fulfilment')}>
            {merchant.shipsOwn ? t('dashboard.shipsOwn') : t('dashboard.dropsAtWarehouse')}
          </Row>
          <Row label={t('dashboard.termsVersion')}>{merchant.termsVersion ?? '—'}</Row>
        </dl>

        <p className="text-sm text-ink-600">
          {t('dashboard.termsLinkIntro')}{' '}
          <Link href="/legal/marketplace-terms" className="underline hover:text-forest-800">
            {t('dashboard.termsLink')}
          </Link>
        </p>
      </section>

      {merchant.status === 'approved' && (
        <div>
          <Link href="/merchant/offers/new" className={buttonVariants()}>
            {t('dashboard.addOffer')}
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 font-display text-2xl font-semibold text-forest-900">
        {icon && <Trophy className="size-4 text-lime-500" aria-hidden="true" />}
        <span data-numeric>{value}</span>
      </dd>
      {hint && <p className="mt-1 text-[13px] text-ink-500">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}
