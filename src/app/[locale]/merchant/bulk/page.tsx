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
      /*
       * Every cell quoted, not just the two names.
       *
       * `merchant_sku` is free text up to 64 characters, so a merchant whose internal code is `ART;114`
       * was handed a file *we* had corrupted: the row gained a column, every value after it shifted, and
       * the parser read the shifted stock as real. The parser now refuses such a row, but the file it
       * refuses is one we wrote — so quote at the source too, and the round trip works.
       */
      [
        row.sku,
        row.merchantSku,
        row.productName,
        row.variantName,
        row.status,
        String(row.stockOnHand),
        fromCents(row.priceCents).replace('.', ','),
      ]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(';'),
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
          <div className="flex flex-wrap items-center gap-3">
            {/*
              Excel first, CSV second, because the CSV is where the trouble came from.

              A CSV cannot carry a column type, so Excel re-guesses every cell on open: the barcode
              becomes 8.71235E+12, `MAR-3` becomes a date, and a comma decimal collides with a comma
              delimiter. The workbook marks the identifier columns as Text and arrives already filled
              with this merchant's own SKUs, stock and prices — so updating stock is typing over numbers
              rather than building a sheet, and it uploads back without being converted.

              The CSV stays for anyone whose tooling wants it, demoted to a plain link.
            */}
            {/*
              A real anchor, not <Link>. This is a file download: a client-side transition to a route
              handler would navigate rather than save, and the lint rule cannot tell the two apart.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/merchant/template/offers"
              className="inline-flex min-h-11 items-center rounded-md bg-forest-800 px-4 text-sm font-medium text-cream hover:bg-forest-900"
            >
              {t('downloadExcel')}
            </a>
            <a
              href={dataUrl}
              download={`biocode-offers-${merchant.slug}.csv`}
              className="text-sm text-forest-800 underline underline-offset-4"
            >
              {t('download')}
            </a>
          </div>
        )}
      </section>

      {/*
        The catalogue, which is what makes bulk *creation* usable (§6.1).

        A merchant cannot paste `sku;price;stock` for products whose codes it has never been told — every
        guess lands in the report as `unknown_sku`. A route handler rather than an inlined `data:` URL,
        because this file is every published variant rather than a handful of the merchant's own rows.
      */}
      <section aria-labelledby="catalogue" className="flex flex-col gap-3">
        <h3 id="catalogue" className="font-display text-lg font-semibold text-forest-900">
          {t('catalogueTitle')}
        </h3>
        <p className="text-sm text-ink-600">{t('catalogueIntro')}</p>
        <div>
          {/*
            A plain anchor with `download`, not next/link: the target is a route handler that answers with a
            CSV attachment, so a client-side transition would try to render a file as a page. The `download`
            attribute is also what tells `no-html-link-for-pages` this is a file rather than a route.
          */}
          <a
            href="/api/merchant/catalogue"
            download="biocode-catalogue.csv"
            className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-forest-800 hover:bg-forest-50"
          >
            {t('catalogueDownload')}
          </a>
        </div>
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
