import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { CheckCircle2, FileText } from 'lucide-react';
import { getMyMerchant, listMyDocuments } from '@/features/merchants/queries';
import { DocumentUpload } from '@/features/merchants/components/document-upload';

export const metadata: Metadata = { title: 'Dokumentet' };
export const dynamic = 'force-dynamic';

/**
 * docs/16 §4 — the KYB documents, and the one screen a pending merchant can actually use.
 *
 * This page is deliberately available at every merchant status, because it is what unblocks approval:
 * the application arrives without documents (the storage path needs a merchant id, which does not
 * exist until the row does), and until the registration certificate is here the reviewer cannot say
 * yes.
 *
 * **Uploads are append-only.** The bucket has no update or delete policy for anyone, including
 * BioCode: a document is evidence of who somebody claimed to be when they were approved, and
 * replacing one in place would leave the row pointing at different bytes than the reviewer verified.
 * A correction is a new upload, which is why the list can hold two of the same kind and says so.
 */
export default async function MerchantDocumentsPage() {
  const merchant = await getMyMerchant();
  if (!merchant) return null;

  const t = await getTranslations('merchant.documents');
  const documents = await listMyDocuments();

  const hasRegistration = documents.some((doc) => doc.kind === 'business_registration');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
      </header>

      {!hasRegistration && (
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
          {t('registrationRequired')}
        </p>
      )}

      <DocumentUpload merchantId={merchant.id} />

      <section aria-labelledby="uploaded" className="flex flex-col gap-3">
        <h3 id="uploaded" className="font-display text-lg font-semibold text-forest-900">
          {t('uploadedTitle')}
        </h3>

        {documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
              >
                <FileText className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
                <span className="font-medium text-ink-900">{t(`kinds.${doc.kind}`)}</span>
                <span className="text-ink-500">{doc.uploadedAt.slice(0, 10)}</span>
                {doc.verified ? (
                  <span className="ml-auto flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {t('verified')}
                  </span>
                ) : (
                  <span className="ml-auto text-ink-500">{t('awaitingCheck')}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[13px] text-ink-500">{t('appendOnly')}</p>
      </section>
    </div>
  );
}
