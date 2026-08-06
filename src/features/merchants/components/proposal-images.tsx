'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Mirrors the bucket exactly, so an image accepted here cannot be refused on upload. */
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/webp,image/jpeg,image/png,image/avif';
const MAX_IMAGES = 6;

export interface UploadedImage {
  path: string;
  /** A local blob URL for the preview. Never sent anywhere. */
  preview: string;
  name: string;
}

/**
 * docs/16 §9 — the photographs a merchant sends with a proposal.
 *
 * ── Uploaded before the proposal exists, which is fine ──
 *
 * The storage path is `proposals/<merchant_id>/…` and the merchant id is known while the form is still
 * being filled, so these can go straight up and the finished paths ride along with the submission as
 * hidden inputs. That is the opposite of the KYB documents, where the path needs a merchant id that does
 * not exist until the application is submitted (§4) — same two-step shape, different reason for the
 * ordering.
 *
 * The bytes go **from the browser**, as they do for KYB documents: a server action's body is capped at
 * 1 MB by default and a phone photograph is routinely larger, so posting six of them through an action
 * would reject exactly the uploads this exists to collect.
 *
 * ── An abandoned upload leaves a file behind ──
 *
 * A merchant who uploads three photos and then closes the tab leaves three objects in a private bucket
 * with no proposal pointing at them. Stated rather than solved: they are invisible, they cost almost
 * nothing, and the alternative — a cleanup job over a bucket keyed on rows that were never written — is
 * more machinery than the problem deserves. Removing one before submitting works, which covers the case
 * a merchant actually notices.
 */
export function ProposalImages({
  merchantId,
  images,
  onChange,
}: {
  merchantId: string;
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}) {
  const t = useTranslations('merchant.proposals.images');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | null): Promise<void> {
    setError(null);
    if (!files || files.length === 0) return;

    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(t('errors.tooMany', { max: MAX_IMAGES }));
      return;
    }

    const chosen = Array.from(files).slice(0, room);
    setBusy(true);

    try {
      // Imported here, not at module scope: see the note in `document-upload.tsx` — it is 80 kB.
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const added: UploadedImage[] = [];

      for (const file of chosen) {
        if (file.size > MAX_BYTES) {
          setError(t('errors.tooLarge', { name: file.name }));
          continue;
        }

        const safeName = file.name
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .slice(-60);
        const path = `proposals/${merchantId}/${Date.now()}-${added.length}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from('merchant-proposals')
          .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' });

        if (uploadError) {
          setError(t('errors.uploadFailed', { name: file.name }));
          continue;
        }

        added.push({ path, preview: URL.createObjectURL(file), name: file.name });
      }

      if (added.length > 0) onChange([...images, ...added]);
    } finally {
      setBusy(false);
    }
  }

  async function remove(image: UploadedImage): Promise<void> {
    /*
     * Deleted from the bucket as well as from the list. The merchant holds a delete policy on its own
     * folder precisely for this — unlike a KYB document, a product photo is not evidence of anything and
     * a merchant that picked the wrong file should be able to take it back.
     */
    try {
      const { createClient } = await import('@/lib/supabase/client');
      await createClient().storage.from('merchant-proposals').remove([image.path]);
    } catch {
      // A file left behind is invisible and harmless; removing it from the list is what the user asked.
    }
    URL.revokeObjectURL(image.preview);
    onChange(images.filter((entry) => entry.path !== image.path));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-ink-900">{t('label')}</p>
        <p className="text-[13px] text-ink-500">{t('hint', { max: MAX_IMAGES })}</p>
      </div>

      {images.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {images.map((image) => (
            <li key={image.path} className="relative">
              {/*
                A plain `img`, not `next/image`. The source is a local blob URL that exists only in this
                tab — the optimiser cannot fetch it, and there is nothing to optimise.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.preview}
                alt={t('previewAlt', { name: image.name })}
                className="size-24 rounded-md border border-line object-cover"
              />
              <button
                type="button"
                onClick={() => void remove(image)}
                aria-label={t('remove', { name: image.name })}
                className="absolute -top-2 -right-2 inline-flex size-6 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-900 shadow-sm hover:bg-error hover:text-white"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The paths, and only the paths, travel with the form. The action verifies each one. */}
      {images.map((image) => (
        <input key={image.path} type="hidden" name="imagePaths" value={image.path} />
      ))}

      {error && <Alert tone="error">{error}</Alert>}

      {images.length < MAX_IMAGES && (
        <div>
          <label htmlFor="proposal-images" className="sr-only">
            {t('label')}
          </label>
          <input
            id="proposal-images"
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            onChange={(event) => void upload(event.target.files)}
            className="hidden"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => document.getElementById('proposal-images')?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {busy ? t('uploading') : t('add')}
          </Button>
        </div>
      )}

      <p className="text-[13px] text-ink-500">{t('rights')}</p>
    </div>
  );
}
