import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getMyMerchant } from '@/features/merchants/queries';
import { listLedger, listPayouts, merchantBalance } from '@/features/merchants/payout-queries';

export const metadata: Metadata = { title: 'Shlyerjet' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

/**
 * docs/16 §8 — what the merchant is owed, and what has been paid.
 *
 * Three things in the order a merchant asks for them: the balance, the statements, and the running
 * account behind both. The account is last because it is the audit trail — useful when a number is
 * disputed, noise the rest of the time.
 *
 * **The balance is a plain sum of the ledger**, payouts included: a payout row is negative, so a settled
 * fortnight leaves nothing behind and there is no "unpaid" flag anywhere to fall out of step with it.
 */
export default async function MerchantPayoutsPage({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant) notFound();

  const t = await getTranslations('merchant.payouts');

  const [balance, payouts, ledger] = await Promise.all([
    merchantBalance(merchant.id),
    listPayouts(),
    listLedger(30),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro', { pct: merchant.commissionPct })}</p>
      </header>

      <section aria-labelledby="balance" className="flex flex-col gap-3">
        <h3 id="balance" className="font-display text-lg font-semibold text-forest-900">
          {t('balanceTitle')}
        </h3>

        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {balance.balanceCents >= 0 ? t('owedToYou') : t('owedByYou')}
          </p>
          <p
            className={cn(
              'mt-1 font-display text-3xl font-semibold',
              balance.balanceCents >= 0 ? 'text-forest-900' : 'text-error',
            )}
            data-numeric
          >
            {formatPrice(Math.abs(balance.balanceCents), locale)}
          </p>
          <p className="mt-2 text-sm text-ink-600">
            {balance.balanceCents === 0 ? t('settled') : t('nextRun')}
          </p>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label={t('sales')} value={formatPrice(balance.salesCents, locale)} />
          <Figure
            label={t('commission')}
            value={formatPrice(Math.abs(balance.commissionCents), locale)}
            negative
          />
          {balance.shippingCents !== 0 && (
            <Figure
              label={t('shipping')}
              value={formatPrice(Math.abs(balance.shippingCents), locale)}
              negative
            />
          )}
          {balance.codCents !== 0 && (
            <Figure
              label={t('codHeld')}
              value={formatPrice(Math.abs(balance.codCents), locale)}
              negative
            />
          )}
          <Figure label={t('paidOut')} value={formatPrice(Math.abs(balance.paidOutCents), locale)} />
        </dl>
      </section>

      <section aria-labelledby="statements" className="flex flex-col gap-3">
        <h3 id="statements" className="font-display text-lg font-semibold text-forest-900">
          {t('statementsTitle')}
        </h3>

        {payouts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('noStatements')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {payouts.map((payout) => (
              <li key={payout.id}>
                <Link
                  href={`/merchant/payouts/${payout.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-sm transition-colors hover:border-forest-500/50 hover:bg-forest-50/40"
                >
                  <span>
                    <span className="block font-medium text-ink-900" data-numeric>
                      {payout.periodStart} – {payout.periodEnd}
                    </span>
                    <span className="text-[13px] text-ink-500">
                      {payout.status === 'paid' && payout.paidAt
                        ? t('paidOn', { date: payout.paidAt.slice(0, 10) })
                        : t(`status.${payout.status}`)}
                    </span>
                  </span>
                  <span className="font-ui font-semibold text-forest-900" data-numeric>
                    {formatPrice(payout.netCents, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="account" className="flex flex-col gap-3">
        <h3 id="account" className="font-display text-lg font-semibold text-forest-900">
          {t('accountTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('accountIntro')}</p>

        {ledger.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('noEntries')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <caption className="sr-only">{t('accountCaption')}</caption>
              <thead>
                <tr className="border-b border-line bg-cream text-left">
                  <Th>{t('date')}</Th>
                  <Th>{t('kind')}</Th>
                  <Th>{t('amount')}</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 whitespace-nowrap" data-numeric>
                      {entry.createdAt.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-ink-900">{t(`kinds.${kindKey(entry.kind)}`)}</span>
                      {entry.note && (
                        <span className="block text-[13px] text-ink-500">{entry.note}</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 font-medium whitespace-nowrap',
                        entry.amountCents < 0 ? 'text-error' : 'text-forest-900',
                      )}
                      data-numeric
                    >
                      {entry.amountCents < 0 ? '−' : '+'}
                      {formatPrice(Math.abs(entry.amountCents), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The ledger kinds, narrowed for `t()`.
 *
 * `kind` is a text column with a check constraint rather than an enum, so it arrives as `string` and a
 * template message key over it would not typecheck. Anything unrecognised reads as an adjustment, which
 * is what a row nobody has a label for effectively is.
 */
const KINDS = [
  'sale',
  'commission',
  'shipping',
  'cod_collected',
  'refund',
  'adjustment',
  'payout',
] as const;

function kindKey(kind: string): (typeof KINDS)[number] {
  return (KINDS as readonly string[]).includes(kind)
    ? (kind as (typeof KINDS)[number])
    : 'adjustment';
}

function Figure({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</dt>
      <dd
        className={cn('mt-1 font-ui font-semibold', negative ? 'text-error' : 'text-ink-900')}
        data-numeric
      >
        {negative ? '−' : ''}
        {value}
      </dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
    >
      {children}
    </th>
  );
}
