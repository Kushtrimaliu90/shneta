import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Ticket } from 'lucide-react';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { getLoyalty } from '@/features/loyalty/queries';
import { RedeemButton } from '@/features/loyalty/components/redeem-button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'account.loyalty',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 and docs/07 §9 — points, the ledger, and the exchange.
 *
 * The ledger is the point of the page. A balance on its own invites "where did those go?", and
 * the two entries a customer will actually question — a refund clawing points back, and an
 * exchange spending them — are the ones a bare number hides.
 */
export default async function AccountLoyaltyPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [loyalty, t] = await Promise.all([getLoyalty(), getTranslations('account.loyalty')]);

  // The account layout already redirects a signed-out visitor; this is the type narrowing.
  if (!loyalty) notFound();

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('title')}</h2>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <div className="rounded-lg border border-line bg-forest-50 p-5">
            <p className="eyebrow">{t('ledgerTitle')}</p>
            <p className="mt-1 font-display text-4xl font-semibold text-forest-900" data-numeric>
              {loyalty.balance}
            </p>
            <p className="mt-1 text-sm text-ink-600" data-numeric>
              {t('balance', { count: loyalty.balance })}
            </p>
          </div>

          {loyalty.entries.length === 0 ? (
            <EmptyState icon={Ticket} title={t('emptyLedger')} body={t('terms')} className="mt-6" />
          ) : (
            <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <caption className="sr-only">{t('ledgerTitle')}</caption>
                <thead>
                  <tr className="border-b border-line bg-forest-50 text-left">
                    <th scope="col" className="px-3 py-2 font-ui text-xs font-semibold text-ink-600 uppercase">
                      {t('ledgerActivity')}
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      {t('ledgerPoints')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loyalty.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="block text-ink-900">{t(`reason.${entry.reason}`)}</span>
                        <span className="block text-xs text-ink-500">
                          <time dateTime={entry.createdAt} data-numeric>
                            {entry.createdAt.slice(0, 10)}
                          </time>
                          {entry.orderNumber && (
                            <>
                              {' · '}
                              <span data-numeric>{entry.orderNumber}</span>
                            </>
                          )}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-medium whitespace-nowrap',
                          entry.points >= 0 ? 'text-success' : 'text-ink-600',
                        )}
                        data-numeric
                      >
                        {entry.points >= 0 ? `+${entry.points}` : entry.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside>
          <RedeemButton
            balance={loyalty.balance}
            redeemPoints={loyalty.redeemPoints}
            redeemValueCents={loyalty.redeemValueCents}
          />
        </aside>
      </div>
    </div>
  );
}
