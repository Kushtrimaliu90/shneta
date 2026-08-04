import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { getMyMerchant } from '@/features/merchants/queries';
import { getStatement } from '@/features/merchants/payout-queries';
import { ScrollRegion } from '@/components/ui/scroll-region';

export const metadata: Metadata = { title: 'Pasqyra' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

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

/**
 * docs/16 §8 — one statement, line by line.
 *
 * This is the document a merchant checks its own books against, so **every line names the order it came
 * from**. A statement that showed only a net figure would be a number to argue about; one that shows the
 * sale, the commission and the order number for each is a number to verify.
 *
 * `getStatement` returns null for a payout this merchant may not read, so another merchant's id is a
 * 404 — the same answer as an id that does not exist.
 *
 * Printable by design: no fixed bars, no interactive controls, and the totals are in the flow rather
 * than in a sticky footer. A merchant will print this for its accountant.
 */
export default async function MerchantStatementPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);

  const merchant = await getMyMerchant();
  if (!merchant) notFound();

  const statement = await getStatement(id);
  if (!statement) notFound();

  const t = await getTranslations('merchant.payouts');

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('breadcrumb')} className="print:hidden">
        <Link href="/merchant/payouts" className="text-sm text-forest-800 underline">
          ← {t('title')}
        </Link>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('statementEyebrow')}</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-forest-900" data-numeric>
            {statement.payout.periodStart} – {statement.payout.periodEnd}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {statement.merchant.legalName} · {t('commissionAt', {
              pct: statement.merchant.commissionPct,
            })}
          </p>
        </div>

        <div className="text-right">
          <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {t('net')}
          </p>
          <p className="font-display text-2xl font-semibold text-forest-900" data-numeric>
            {formatPrice(statement.payout.netCents, locale)}
          </p>
          <p className="text-[13px] text-ink-500">
            {statement.payout.status === 'paid' && statement.payout.paidAt
              ? t('paidOn', { date: statement.payout.paidAt.slice(0, 10) })
              : t(`status.${statement.payout.status}`)}
          </p>
        </div>
      </header>

      <dl className="grid gap-3 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {t('gross')}
          </dt>
          <dd className="mt-0.5 text-ink-900" data-numeric>
            {formatPrice(statement.payout.grossCents, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {t('commission')}
          </dt>
          <dd className="mt-0.5 text-error" data-numeric>
            −{formatPrice(statement.payout.commissionCents, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            {t('paidTo')}
          </dt>
          <dd className="mt-0.5 text-ink-900">
            {statement.merchant.ibanLast4
              ? `•••• ${statement.merchant.ibanLast4}`
              : t('noIban')}
          </dd>
        </div>
      </dl>

      {statement.payout.reference && (
        <p className="text-sm text-ink-600">
          {t('reference')} <span data-numeric>{statement.payout.reference}</span>
        </p>
      )}

      <section aria-labelledby="lines" className="flex flex-col gap-3">
        <h3 id="lines" className="font-display text-lg font-semibold text-forest-900">
          {t('linesTitle')}
        </h3>

        <ScrollRegion label={t('linesCaption')} className="rounded-lg border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">{t('linesCaption')}</caption>
            <thead>
              <tr className="border-b border-line bg-cream text-left">
                <Th>{t('date')}</Th>
                <Th>{t('order')}</Th>
                <Th>{t('kind')}</Th>
                <Th>{t('amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 whitespace-nowrap" data-numeric>
                    {line.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2.5" data-numeric>
                    {line.orderNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-ink-900">{t(`kinds.${kindKey(line.kind)}`)}</span>
                    {line.note && <span className="block text-[13px] text-ink-500">{line.note}</span>}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2.5 font-medium whitespace-nowrap',
                      line.amountCents < 0 ? 'text-error' : 'text-forest-900',
                    )}
                    data-numeric
                  >
                    {line.amountCents < 0 ? '−' : '+'}
                    {formatPrice(Math.abs(line.amountCents), locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong bg-cream">
                <td colSpan={3} className="px-3 py-2.5 text-right font-medium text-ink-900">
                  {t('net')}
                </td>
                <td className="px-3 py-2.5 font-ui font-semibold text-forest-900" data-numeric>
                  {formatPrice(statement.payout.netCents, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>

        <p className="text-[13px] text-ink-500">{t('disputeWindow')}</p>
      </section>
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
