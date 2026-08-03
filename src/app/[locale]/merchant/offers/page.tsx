import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getMyMerchant,
  listMyOffers,
  myOfferCounts,
  myWinningOfferIds,
  type OfferStatus,
} from '@/features/merchants/queries';
import { OffersTable } from '@/features/merchants/components/offers-table';

export const metadata: Metadata = { title: 'Ofertat' };
export const dynamic = 'force-dynamic';

const STATUSES: OfferStatus[] = ['approved', 'pending_review', 'draft', 'paused', 'rejected'];

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * docs/16 §5 — the offers list.
 *
 * Filtered by status, with the counts on the chips, because a merchant's first question on this
 * screen is nearly always "what is live?" and their second is "what is stuck?".
 *
 * **A pending merchant gets 404, not an empty list.** The nav already shows the section locked; a
 * merchant who types the URL is answered the same way, and 404 rather than a redirect keeps the
 * answer identical to the one an outsider would get. The actions would refuse anyway — `actingMerchant`
 * requires `approved` — so this only decides how the refusal reads.
 */
export default async function MerchantOffersPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const query = await searchParams;
  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const status = STATUSES.includes(raw as OfferStatus) ? (raw as OfferStatus) : undefined;

  const t = await getTranslations('merchant.offers');
  const [counts, offers] = await Promise.all([myOfferCounts(), listMyOffers(status)]);
  const winning = await myWinningOfferIds(offers);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
          <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
        </div>
        <Link href="/merchant/offers/new" className={buttonVariants({ size: 'sm' })}>
          {t('add')}
        </Link>
      </header>

      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-1.5">
        <FilterChip href="/merchant/offers" active={!status} label={t('all')} />
        {STATUSES.map((entry) => (
          <FilterChip
            key={entry}
            href={`/merchant/offers?status=${entry}`}
            active={status === entry}
            label={t(`status.${entry}`)}
            count={counts[entry]}
          />
        ))}
      </nav>

      {offers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-8 text-center">
          <p className="text-sm text-ink-600">{status ? t('emptyFiltered') : t('empty')}</p>
          {!status && (
            <Link
              href="/merchant/offers/new"
              className={cn(buttonVariants({ size: 'sm' }), 'mt-4')}
            >
              {t('add')}
            </Link>
          )}
        </div>
      ) : (
        <OffersTable offers={offers} winningIds={[...winning]} locale={locale} />
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
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
      {typeof count === 'number' && (
        <span className="font-ui font-semibold" data-numeric>
          {count}
        </span>
      )}
    </Link>
  );
}
