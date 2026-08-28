import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Package, Settings, Ticket } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { VitalityRing } from '@/components/shared/vitality-ring';
import { getProfile } from '@/features/auth/queries';
import { getLoyaltySettings } from '@/features/loyalty/queries';
import { listMyOrders } from '@/features/orders/queries';
import { OrderStatusPill } from '@/features/orders/components/order-status-pill';
import { listSubscriptions } from '@/features/subscriptions/queries';
import { getCodeEntryState } from '@/features/referrals/queries';
import {
  ReferralCodeEntry,
  ReferralSourceNote,
} from '@/features/referrals/components/code-entry-card';
import { buttonVariants } from '@/components/ui/button';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ password?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'account',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — overview: latest order, active subscription, loyalty points, quick links.
 *
 * The latest order comes from the same cache()d `listMyOrders` the orders page reads, and the
 * row repeats that page's anatomy exactly — number, date · item count, status pill, total —
 * so the overview is a preview of the list, not a third way of drawing an order. The empty
 * state renders only when the list is genuinely empty; loyalty is ledger-derived as before.
 */
export default async function AccountOverviewPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);
  const { password } = await searchParams;

  const [profile, loyalty, referral, orders, subscriptions] = await Promise.all([
    getProfile(),
    getLoyaltySettings(),
    getCodeEntryState(),
    listMyOrders(),
    listSubscriptions(),
  ]);
  const t = await getTranslations();

  // The layout guarantees this, but the page must not assume it.
  if (!profile) return null;

  // `listMyOrders` sorts newest first, so the latest order is simply the head of the list.
  const latestOrder = orders[0];
  const activeSubscription = subscriptions.find((sub) => sub.status === 'active');

  /*
   * The threshold comes from settings, not from a constant here.
   *
   * It was hardcoded at 100 and the point-value unification (docs/17 §0.1) moved the real minimum to
   * 500 — so this ring filled up and said "ready to redeem" at a fifth of the points the redeem
   * button will actually accept. A promise the next screen refuses is worse than no promise.
   */
  const redeemThreshold = loyalty.minRedeemPoints;
  const progress = Math.min(1, profile.loyaltyPoints / redeemThreshold);

  return (
    <div className="flex flex-col gap-6">
      {password === 'updated' && (
        <Alert tone="success">{t('account.settings.passwordChanged')}</Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4">
            <VitalityRing value={progress} size={56} strokeWidth={5} />
            <div>
              <p className="eyebrow">{t('account.loyalty.title')}</p>
              <p className="mt-1 font-display text-2xl font-semibold text-forest-900" data-numeric>
                {t('account.loyalty.points', { count: profile.loyaltyPoints })}
              </p>
              <p className="mt-1 text-sm text-ink-500">
                {profile.loyaltyPoints >= redeemThreshold
                  ? t('account.loyalty.readyToRedeem')
                  : t('account.loyalty.toNextReward', {
                      count: redeemThreshold - profile.loyaltyPoints,
                    })}
              </p>
              {referral.source && (
                <div className="mt-3">
                  <ReferralSourceNote
                    referrerName={referral.source.referrerName}
                    pending={referral.source.status === 'pending'}
                  />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {latestOrder ? (
              <>
                <p className="eyebrow">{t('account.overview.latestOrder')}</p>
                {/* The row anatomy of /account/orders, so the preview and the list agree. */}
                <Link
                  href={`/account/orders/${latestOrder.orderNumber}`}
                  className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 transition-colors hover:border-line-strong hover:bg-forest-50/40"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-forest-900" data-numeric>
                      {latestOrder.orderNumber}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-600">
                      {t('order.myOrders.placedOn', {
                        date: new Date(latestOrder.placedAt).toLocaleDateString(locale),
                      })}
                      {' · '}
                      {t('order.myOrders.itemCount', { count: latestOrder.itemCount })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <OrderStatusPill status={latestOrder.status} />
                    <span className="font-semibold text-forest-900" data-numeric>
                      {formatPrice(latestOrder.totalCents, locale)}
                    </span>
                  </div>
                </Link>
                {activeSubscription && (
                  <p className="mt-3 text-sm text-ink-600" data-numeric>
                    {t('account.overview.nextDelivery', {
                      date: new Date(activeSubscription.nextRunAt).toLocaleDateString(locale),
                    })}
                  </p>
                )}
                <Link
                  href="/account/orders"
                  className="mt-1 inline-flex min-h-11 items-center text-sm text-forest-700 underline underline-offset-4 hover:text-forest-800"
                >
                  {t('account.overview.viewAllOrders')}
                </Link>
              </>
            ) : (
              <>
                <p className="eyebrow">{t('account.nav.orders')}</p>
                <p className="mt-2 text-sm text-ink-600">{t('account.overview.noOrdersYet')}</p>
                <Link
                  href="/shop"
                  className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} mt-4`}
                >
                  {t('common.browseShop')}
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {referral.canEnter && <ReferralCodeEntry suggestedCode={referral.suggestedCode} />}

      <Card>
        <CardContent>
          <h2 className="font-display text-lg font-semibold text-forest-900">
            {t('account.overview.quickLinks')}
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            <li>
              <Link
                href="/account/settings"
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm text-forest-700 hover:bg-forest-50"
              >
                <Settings className="size-4" aria-hidden="true" />
                {t('account.nav.settings')}
              </Link>
            </li>
            <li>
              <Link
                href="/order-lookup"
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm text-forest-700 hover:bg-forest-50"
              >
                <Package className="size-4" aria-hidden="true" />
                {t('footer.orderLookup')}
              </Link>
            </li>
            <li>
              <Link
                href="/offers"
                className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm text-forest-700 hover:bg-forest-50"
              >
                <Ticket className="size-4" aria-hidden="true" />
                {t('nav.offers')}
              </Link>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
