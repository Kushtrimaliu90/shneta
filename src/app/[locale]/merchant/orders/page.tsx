import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { cn } from '@/lib/utils';
import { getMyMerchant } from '@/features/merchants/queries';
import {
  listMyFulfilments,
  myFulfilmentCounts,
  type FulfilmentStatus,
} from '@/features/merchants/fulfilment-queries';
import { FulfilmentList } from '@/features/merchants/components/fulfilment-list';

export const metadata: Metadata = { title: 'Porositë' };
export const dynamic = 'force-dynamic';

/**
 * docs/16 §7 — the merchant's orders.
 *
 * Filtered by status, and the default is **everything that needs the merchant**: assigned, accepted and
 * packed. A merchant opening this screen is asking "what do I have to do?", not "show me my history" —
 * and a list that opened on three hundred delivered parcels would answer the wrong question.
 */
const OPEN: readonly FulfilmentStatus[] = ['assigned', 'accepted', 'packed'];

const FILTERS: readonly FulfilmentStatus[] = [
  'assigned',
  'accepted',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
];

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MerchantOrdersPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const query = await searchParams;
  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = FILTERS.includes(raw as FulfilmentStatus) ? (raw as FulfilmentStatus) : undefined;

  const t = await getTranslations('merchant.fulfilments');
  const counts = await myFulfilmentCounts();

  /*
   * One RPC per open status when no filter is chosen, rather than fetching everything and filtering in
   * memory: a merchant with a long history would otherwise transfer all of it to render three rows.
   */
  const fulfilments = status
    ? await listMyFulfilments(status)
    : (await Promise.all(OPEN.map((entry) => listMyFulfilments(entry)))).flat();

  const openCount = OPEN.reduce((total, entry) => total + counts[entry], 0);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
      </header>

      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-1.5">
        <Chip href="/merchant/orders" active={!status} label={t('open')} count={openCount} />
        {FILTERS.map((entry) => (
          <Chip
            key={entry}
            href={`/merchant/orders?status=${entry}`}
            active={status === entry}
            label={t(`status.${entry}`)}
            count={counts[entry]}
          />
        ))}
      </nav>

      {fulfilments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-ink-600">
          {status ? t('emptyFiltered') : t('empty')}
        </p>
      ) : (
        <FulfilmentList fulfilments={fulfilments} locale={locale} />
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors',
        active
          ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
          : 'border-line-strong text-ink-600 hover:bg-forest-50',
      )}
    >
      {label}
      <span className="font-ui font-semibold" data-numeric>
        {count}
      </span>
    </Link>
  );
}
