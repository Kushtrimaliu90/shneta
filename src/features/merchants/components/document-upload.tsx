'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
// `next/navigation`'s router deliberately, unlike `offer-form.tsx`: this only ever calls
// `refresh()`, which takes no path and therefore has no locale to get wrong.
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { recordMerchantDocument } from '@/features/merchants/document-actions';

const KINDS = [
  'business_registration',
  'vat_certificate',
  'id_document',
  'import_licence',
  'other',
] as const;

/** Mirrors the bucket: 10 MB, PDF or image. Checked here so the failure is immediate and legible. */
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/**
 * docs/16 §4 — uploading a KYB document.
 *
 * Two steps, deliberately: the **browser** puts the file in Storage on the merchant's own session,
 * then a server action records the row. See `document-actions.ts` for why the bytes do not go through
 * the action — a scanned certificate is larger than a server action's default body limit, and the
 * storage policy already scopes the write to this merchant's folder.
 *
 * ── The path ──
 *
 * `merchants/<merchant_id>/<timestamp>-<name>`. The merchant id is the second segment because that is
 * what the storage policy reads (`(storage.foldername(name))[2]`), and the timestamp is what makes a
 * second upload of `certificate.pdf` a new document rather than a silent overwrite — the bucket has
 * **no update policy for anyone** (§4), so an upsert would fail rather than replace, and a document is
 * evidence of what a reviewer verified.
 *
 * `upsert: false` is therefore not a precaution; it is the only thing the bucket permits.
 */
export function DocumentUpload({ merchantId }: { merchantId: string }) {
  const t = useTranslations('merchant.documents');
  const router = useRouter();

  const [kind, setKind] = useState<(typeof KINDS)[number]>('business_registration');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload() {
    setError(null);
    setDone(false);

    if (!file) {
      setError(t('errors.noFile'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('errors.tooLarge'));
      return;
    }

    /*
     * The browser Supabase client, imported **here rather than at module scope**.
     *
     * `@supabase/ssr` and `supabase-js` together are about 80 kB, and a static import put them in
     * this page's first load — `pnpm check:bundle` failed at 215 kB against a 170 kB budget, which is
     * exactly the check earning its place. Nobody needs those bytes until they have chosen a file, so
     * they arrive on the click that needs them.
     *
     * The rest of the portal is server-rendered and touches no Supabase client at all; this is the
     * one screen that has to talk to Storage from the browser (see `document-actions.ts`).
     */
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();

    /*
     * A safe filename. The original is kept for the reviewer's benefit but stripped of anything that
     * would change the path's shape — a slash would put the object in a folder the policy does not
     * cover, and the upload would be refused with a message nobody could interpret.
     */
    const safeName = file.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-80);
    const path = `merchants/${merchantId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('merchant-docs')
      .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });

    if (uploadError) {
      setError(t('errors.uploadFailed'));
      return;
    }

    const formData = new FormData();
    formData.set('kind', kind);
    formData.set('storagePath', path);

    const result = await recordMerchantDocument(null, formData);
    if (!result?.ok) {
      setError(t('errors.generic'));
      return;
    }

    setFile(null);
    setDone(true);
    // The list is server-rendered, so it needs a refresh rather than local state.
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="kind" label={t('kind')} hint={t('kindHint')}>
          {(field) => (
            <select
              {...field}
              value={kind}
              onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}
              className="h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base"
            >
              {KINDS.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`kinds.${entry}`)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="file" label={t('file')} hint={t('fileHint')}>
          {(field) => (
            <input
              {...field}
              type="file"
              accept={ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="min-h-11 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-forest-100 file:px-3 file:py-1.5 file:text-sm file:text-forest-900"
            />
          )}
        </Field>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {done && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-success">
          {t('uploaded')}
        </p>
      )}

      <div>
        <Button onClick={() => void upload()} disabled={!file || pending}>
          <Upload className="size-4" aria-hidden="true" />
          {t('upload')}
        </Button>
      </div>
    </div>
  );
}
