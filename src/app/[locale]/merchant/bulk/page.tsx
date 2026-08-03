import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { fromCents } from '@/lib/money';
import { getMyMerchant } from '@/features/merchants/queries';
import { offersExport } from '@/features/merchants/proposal-queries';
import { BulkForm } from '@/features/merchants/components/bulk-form';

export const metadata: Metadata = { title: 'Përditësim masiv' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

/**
 * docs/16 §6 — updating many offers at once.
 *
 * The export is above the paste box, and the order is the point: **a merchant that edits the sheet it was
 * given has the right SKUs by construction**, so `no_matching_offer` stops being the usual outcome. A
 * bulk-update feature with no export is one where the first attempt fails and nobody tries again.
 *
 * Semicolons in the export, and a comma decimal in the price, because that is what Excel here reads and
 * writes. The parser accepts commas and tabs too — but the file we hand out should be the one that opens
 * correctly on the merchant's machine without a dialog.
 */
export default async function MerchantBulkPage({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const t = await getTranslations('merchant.bulk');
  const rows = await offersExport(merchant.id);

  /*
   * A data: URL rather than a route handler. The sheet is a few kilobytes of the merchant's own offers,
   * already fetched to render the count — so an endpoint would be a second query and a second
   * authorisation path for bytes this page already holds.
   */
  const header = ['sku', 'merchant_sku', 'product', 'variant', 'status', 'stok', 'cmimi'];
  const csv = [
    header.join(';'),
    ...rows.map((row) =>
      [
        row.sku,
        row.merchantSku,
        // Quoted: product names contain semicolons and commas often enough to matter.
        `"${row.productName.replace(/"/g, '""')}"`,
        `"${row.variantName.replace(/"/g, '""')}"`,
        row.status,
        String(row.stockOnHand),
        fromCents(row.priceCents).replace('.', ','),
      ].join(';'),
    ),
  ].join('\r\n');

  const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${csv}`)}`;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('pageIntro')}</p>
      </header>

      <section aria-labelledby="export" className="flex flex-col gap-3">
        <h3 id="export" className="font-display text-lg font-semibold text-forest-900">
          {t('exportTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('exportIntro', { count: rows.length })}</p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('noOffers')}{' '}
            <Link href="/merchant/offers/new" className="underline">
              {t('addOne')}
            </Link>
          </p>
        ) : (
          <div>
            <a
              href={dataUrl}
              download={`biocode-offers-${merchant.slug}.csv`}
              className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-forest-800 hover:bg-forest-50"
            >
              {t('download')}
            </a>
          </div>
        )}
      </section>

      <section aria-labelledby="upload" className="flex flex-col gap-3">
        <h3 id="upload" className="font-display text-lg font-semibold text-forest-900">
          {t('uploadTitle')}
        </h3>
        <BulkForm />
      </section>

      <p className="text-[13px] text-ink-500">{t('locale', { locale })}</p>
    </div>
  );
}
