import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Package, Settings, Ticket } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { VitalityRing } from '@/components/shared/vitality-ring';
import { getProfile } from '@/features/auth/queries';
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
 * Orders and subscriptions land in M5/M9, so those cards are not faked with placeholder
 * numbers. Loyalty is real: the balance is ledger-derived and already accrues.
 */
export default async function AccountOverviewPage({ params, searchParams }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const { password } = await searchParams;

  const profile = await getProfile();
  const t = await getTranslations();

  // The layout guarantees this, but the page must not assume it.
  if (!profile) return null;

  const redeemThreshold = 100;
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="eyebrow">{t('account.nav.orders')}</p>
            <p className="mt-2 text-sm text-ink-600">{t('account.overview.noOrdersYet')}</p>
            <Link
              href="/shop"
              className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} mt-4`}
            >
              {t('home.hero.ctaPrimary')}
            </Link>
          </CardContent>
        </Card>
      </div>

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
