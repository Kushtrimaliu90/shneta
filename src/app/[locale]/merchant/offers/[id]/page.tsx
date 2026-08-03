import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import {
  getMyMerchant,
  getMyOffer,
  marketplaceMaxHandlingDays,
} from '@/features/merchants/queries';
import { OfferForm } from '@/features/merchants/components/offer-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

export const metadata: Metadata = { title: 'Oferta' };

/**
 * docs/16 §5 — one offer, edited.
 *
 * `getMyOffer` reads through RLS, so an id belonging to another merchant returns null and this page
 * is a 404 — not because it checked, but because the row does not exist as far as this session is
 * concerned. That is the isolation working rather than being enforced twice.
 *
 * The variant cannot be changed here. One offer per merchant per variant is a unique constraint, and
 * an offer that could be pointed at a different product would silently change what it sells while
 * keeping its history and its approval.
 */
export default async function EditOfferPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);

  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const [offer, maxHandling] = await Promise.all([getMyOffer(id), marketplaceMaxHandlingDays()]);
  if (!offer) notFound();

  const t = await getTranslations('merchant.offers');

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('breadcrumb')}>
        <Link href="/merchant/offers" className="text-sm text-forest-800 underline">
          ← {t('title')}
        </Link>
      </nav>

      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">
          {pickLocale(offer.productName, locale)}
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          {pickLocale(offer.variantName, locale) || offer.sku} · {offer.sku} ·{' '}
          {t(`status.${offer.status}`)}
        </p>
      </header>

      {offer.status === 'rejected' && offer.rejectionNote && (
        <p className="rounded-lg border border-error/40 bg-error/5 p-4 text-sm text-ink-900">
          <span className="font-medium">{t('rejectedNote')}</span> {offer.rejectionNote}
        </p>
      )}

      <OfferForm
        mode="edit"
        locale={locale}
        variants={[]}
        offer={offer}
        settlementPerUnitCents={{ [offer.variantId]: offer.merchantDueCents }}
        maxHandlingDays={maxHandling}
      />
    </div>
  );
}
