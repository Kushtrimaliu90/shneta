import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { getMyMerchant } from '@/features/merchants/queries';
import { getBatch } from '@/features/merchants/batch-queries';
import { BatchImages } from '@/features/merchants/components/batch-images';

export const metadata: Metadata = { title: 'Katalogu i dërguar' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; batchId: string }> };

/**
 * docs/16 §9.1 — one pasted catalogue: what was sent, what the reviewer said, and the photographs.
 *
 * ── The photograph step is the reason this page exists ──
 *
 * A batch's rows arrive without images, because a server action's body is capped at 1 MB and three hundred
 * phone photographs are not going through it. So the images are uploaded from the browser here and matched to
 * rows by filename — the barcode or the merchant's own SKU — which is what turns "select the product for each
 * picture" from three hundred dropdowns into a handful.
 *
 * Uploading closes once the batch is decided: promotion copies each row's images onto its draft product, and a
 * photograph added afterwards would leave the product missing one with nothing to say why.
 */
export default async function MerchantBatchPage({ params }: Props) {
  const { locale: rawLocale, batchId } = await params;
  const locale = resolveLocale(rawLocale);

  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  // RLS scopes the read to this merchant's own batches, so a foreign id is simply not found.
  const batch = await getBatch(batchId);
  if (!batch) notFound();

  const t = await getTranslations('merchant.batches');
  const withImages = batch.rows.filter((row) => row.imagePaths.length > 0).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link href="/merchant/proposals/bulk" className="text-[13px] text-forest-800 underline">
          {t('backToBatches')}
        </Link>
        <h2 className="font-display text-xl font-semibold text-forest-900">
          {t('rowCount', { count: batch.rowCount })}
        </h2>
        <p className="text-sm text-ink-600">
          {new Date(batch.createdAt).toLocaleDateString(locale)} · {t(`status.${batch.status}`)} ·{' '}
          {t('withImages', { count: withImages, total: batch.rows.length })}
        </p>
        {batch.note && <p className="text-sm text-ink-900">{batch.note}</p>}
      </header>

      {batch.reviewerNote && (
        <p className="rounded-md border border-line bg-cream p-3 text-sm text-ink-900">
          <span className="font-medium">{t('reviewerNote')}</span> {batch.reviewerNote}
        </p>
      )}

      {batch.status === 'pending' ? (
        <section aria-labelledby="images" className="flex flex-col gap-3">
          <h3 id="images" className="font-display text-lg font-semibold text-forest-900">
            {t('images.title')}
          </h3>
          <BatchImages
            batchId={batch.id}
            merchantId={merchant.id}
            rows={batch.rows
              .filter((row) => row.status === 'pending' || row.status === 'needs_info')
              .map((row) => ({
                id: row.id,
                productName: row.productName,
                barcode: row.barcode,
                merchantSku: row.merchantSku,
              }))}
          />
        </section>
      ) : (
        <p className="rounded-lg border border-line bg-cream p-4 text-sm text-ink-900">
          {t('images.closed')}
        </p>
      )}

      <section aria-labelledby="rows" className="flex flex-col gap-3">
        <h3 id="rows" className="font-display text-lg font-semibold text-forest-900">
          {t('rowsTitle')}
        </h3>

        {/* Keyboard-reachable, because an `overflow-x-auto` container is not by default (docs/13 §X6). */}
        <ScrollRegion label={t('rowsTitle')}>
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <Th>{t('columns.product')}</Th>
                <Th>{t('columns.brand')}</Th>
                <Th>{t('columns.barcode')}</Th>
                <Th>{t('columns.stock')}</Th>
                <Th>{t('columns.asking')}</Th>
                <Th>{t('columns.images')}</Th>
                <Th>{t('columns.status')}</Th>
              </tr>
            </thead>
            <tbody>
              {batch.rows.map((row) => (
                <tr key={row.id} className="border-b border-line align-top">
                  <Td>
                    <span className="font-medium text-ink-900">{row.productName}</span>
                    {row.variantName && (
                      <span className="block text-[13px] text-ink-500">{row.variantName}</span>
                    )}
                  </Td>
                  <Td>{row.brandName}</Td>
                  <Td>
                    {row.barcode ? <span data-numeric>{row.barcode}</span> : '—'}
                    {row.merchantSku && (
                      <span className="block font-ui text-[11px] text-ink-500">{row.merchantSku}</span>
                    )}
                  </Td>
                  <Td>{row.stockOnHand}</Td>
                  <Td>{formatPrice(row.askingPriceCents, locale)}</Td>
                  <Td>{row.imagePaths.length}</Td>
                  <Td>
                    <span
                      className={cn(
                        'rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold whitespace-nowrap',
                        row.status === 'approved'
                          ? 'bg-success text-white'
                          : row.status === 'rejected'
                            ? 'bg-error text-white'
                            : row.status === 'needs_info'
                              ? 'bg-warning text-white'
                              : 'bg-ink-600 text-white',
                      )}
                    >
                      {t(`rowStatus.${row.status}`)}
                    </span>
                    {row.reviewerNote && (
                      <span className="mt-1 block text-[13px] text-ink-600">{row.reviewerNote}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-3 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-2 pr-3 text-ink-900">{children}</td>;
}
