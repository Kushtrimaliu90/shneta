import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { getMyMerchant } from '@/features/merchants/queries';
import { listBatches } from '@/features/merchants/batch-queries';
import { BatchForm } from '@/features/merchants/components/batch-form';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Katalog i propozuar' };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

/**
 * docs/16 §9.1 — proposing a whole catalogue at once.
 *
 * ── Why this is a separate screen from `/merchant/proposals` ──
 *
 * The single-proposal form asks for one product carefully: a note arguing for it, a barcode, a source link.
 * A catalogue is a different act — two hundred rows the merchant already holds — and the reviewer answers it
 * as one thing. Two paths, two caps, two shapes of answer.
 *
 * The open batches are listed above the form because that is where a merchant continues: the rows are only
 * half a proposal until the photographs are attached, and the photographs live on the batch's own page.
 */
export default async function MerchantProposalBulkPage({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const t = await getTranslations('merchant.batches');
  const batches = await listBatches();
  const open = batches.filter((batch) => batch.status === 'pending');

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
        <p className="mt-2 text-[13px] text-ink-500">
          {t('singleInstead')}{' '}
          <Link href="/merchant/proposals" className="underline">
            {t('singleLink')}
          </Link>
        </p>
      </header>

      {batches.length > 0 && (
        <section aria-labelledby="sent" className="flex flex-col gap-3">
          <h3 id="sent" className="font-display text-lg font-semibold text-forest-900">
            {t('yours')}
          </h3>
          <ul className="flex flex-col gap-2">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4"
              >
                <div>
                  <Link
                    href={`/merchant/proposals/${batch.id}`}
                    className="font-medium text-forest-800 underline"
                  >
                    {t('rowCount', { count: batch.rowCount })}
                  </Link>
                  <p className="text-[13px] text-ink-500">
                    {new Date(batch.createdAt).toLocaleDateString(locale)}
                    {batch.note && ` · ${batch.note.slice(0, 60)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {/*
                    The photograph step, said out loud.

                    Uploading photos happens on the batch page, and the only route to it was this row's
                    other link — labelled with a row count, "3 rreshta". So a merchant looking for
                    "where do I add the pictures?" was reading a number. Reported on 2026-08-10 as not
                    being able to find the bulk picture upload anywhere; it was two clicks away behind
                    text that never mentioned it.

                    Only while the batch is still open. A batch has two states — `pending` and
                    `decided` — and uploading closes on the second, because promotion has already
                    copied the images to the product.
                  */}
                  {batch.status === 'pending' ? (
                    <Link
                      href={`/merchant/proposals/${batch.id}`}
                      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    >
                      {t('addImages')}
                    </Link>
                  ) : null}
                  <span className="bg-ink-100 rounded-sm px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-900">
                    {t(`status.${batch.status}`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="new" className="flex flex-col gap-3">
        <h3 id="new" className="font-display text-lg font-semibold text-forest-900">
          {t('newTitle')}
        </h3>

        {/* Three open batches is the cap: the reviewer's queue is a day's work, not a wall (§9.1). */}
        {open.length >= 3 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
            {t('errors.tooManyOpen')}
          </p>
        ) : (
          <BatchForm />
        )}
      </section>
    </div>
  );
}
