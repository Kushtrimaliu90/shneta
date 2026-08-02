import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Repeat } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { listSubscriptions } from '@/features/subscriptions/queries';
import { SubscriptionCard } from '@/features/subscriptions/components/subscription-card';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'account.subscriptions',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** docs/05 §14 — the customer's subscriptions, active first. */
export default async function AccountSubscriptionsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [subscriptions, t] = await Promise.all([
    listSubscriptions(),
    getTranslations('account.subscriptions'),
  ]);

  if (subscriptions.length === 0) {
    return (
      <div>
        <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>
        <EmptyState
          icon={Repeat}
          title={t('empty')}
          body={t('emptyHint')}
          className="mt-6"
          action={
            <Link href="/shop" className={buttonVariants({ size: 'sm' })}>
              {t('browseShop')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>

      <ul className="mt-6 flex flex-col gap-5">
        {subscriptions.map((subscription) => (
          <SubscriptionCard key={subscription.id} subscription={subscription} />
        ))}
      </ul>
    </div>
  );
}
