'use client';

import { useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { Trash2, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import {
  attachProductImage,
  createImageUploadUrl,
  removeProductImageForm,
} from '@/features/catalog/media-actions';
import type { ProductImage } from '@/features/catalog/admin-queries';
import { cn } from '@/lib/utils';

/**
 * docs/06 §3.4 — the Media tab.
 *
 * The only place in this codebase where the browser talks to Supabase directly with bytes. The
 * sequence per file is: ask the server for a signed URL, PUT to storage, then tell the server to
 * record the row. See `media-actions.ts` for why the file does not travel through Next.
 *
 * Not `useActionState` here, unlike every other form in the panel: this is a three-step
 * sequence with a network hop in the middle that React's form machinery does not model. A
 * `useTransition` plus explicit state is honest about that rather than bending a form abstraction
 * around it.
 *
 * The limits are checked in the browser, in the action, and by the bucket. That is not
 * redundancy for its own sake — the browser check exists so nobody waits for a 5 MB upload to be
 * told no, and the other two exist because a browser check protects nothing.
 *
 * `supabase-js` is imported **dynamically, inside the upload handler**. Imported at module scope
 * it took `/admin/products/[id]` from 7 kB to 92 kB of client JavaScript — a whole Supabase
 * client shipped to every editor session for a file picker most visits never touch. The budget
 * gate does not police admin routes (docs/09 §3 scopes it to the storefront), which is exactly
 * why it is worth being deliberate here rather than letting it drift. Same technique as the
 * Sentry browser SDK in docs/13 §G3.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ['image/webp', 'image/jpeg', 'image/png', 'image/avif'];

export function MediaTab({
  productId,
  images,
  publicBaseUrl,
}: {
  productId: string;
  images: ProductImage[];
  publicBaseUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);

    // Told before two megabytes travel, not after.
    if (file.size > MAX_BYTES) {
      setError(CATALOG_ERRORS['admin.catalog.errors.fileTooLarge']);
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      setError(CATALOG_ERRORS['admin.catalog.errors.fileType']);
      return;
    }

    setUploading(true);
    try {
      const signForm = new FormData();
      signForm.set('productId', productId);
      signForm.set('contentType', file.type);
      signForm.set('size', String(file.size));

      const signed = await createImageUploadUrl(null, signForm);
      if (!signed?.ok || !signed.data.path || !signed.data.token) {
        setError(signed && !signed.ok ? CATALOG_ERRORS[signed.error] : 'Upload failed.');
        return;
      }

      // Loaded on first upload, never at page load — see the note at the top of this file.
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .uploadToSignedUrl(signed.data.path, signed.data.token, file, {
          contentType: file.type,
        });

      if (uploadError) {
        setError(CATALOG_ERRORS['admin.catalog.errors.uploadFailed']);
        return;
      }

      const attachForm = new FormData();
      attachForm.set('productId', productId);
      attachForm.set('path', signed.data.path);

      const attached = await attachProductImage(null, attachForm);
      if (!attached?.ok) {
        /*
         * The bytes are up but the row failed. Remove the object rather than leave an orphan
         * nothing references — the operator will retry, and a second attempt should not leave
         * two copies behind.
         */
        await supabase.storage.from('product-images').remove([signed.data.path]);
        setError(attached && !attached.ok ? CATALOG_ERRORS[attached.error] : 'Upload failed.');
        return;
      }

      // The action revalidated the page; refresh so the new image appears.
      startTransition(() => {
        if (inputRef.current) inputRef.current.value = '';
        window.location.reload();
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-6 text-center">
        <label
          htmlFor="image-upload"
          className={cn(buttonVariants({ size: 'sm' }), 'cursor-pointer')}
        >
          <Upload className="size-4" aria-hidden="true" />
          {uploading ? 'Uploading…' : 'Choose an image'}
        </label>
        <input
          ref={inputRef}
          id="image-upload"
          type="file"
          accept={ALLOWED.join(',')}
          disabled={uploading || pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="sr-only"
        />
        <p className="mt-2 text-xs text-ink-600">
          WebP, JPEG, PNG or AVIF · up to 2 MB · square images look best
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {/* The one publish requirement an operator forgets, so it is said where it is fixed. */}A
          product needs at least one image before it can be published.
        </p>
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {images.length === 0 ? (
        <p className="mt-4 text-sm text-ink-600">No images yet.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((image, index) => (
            <li key={image.id} className="rounded-lg border border-line bg-surface p-2">
              <div className="relative aspect-square overflow-hidden rounded-sm bg-cream">
                <Image
                  src={`${publicBaseUrl}/${image.storagePath}`}
                  alt={image.alt.sq ?? image.alt.en ?? ''}
                  fill
                  sizes="160px"
                  className="object-contain p-1"
                  // Admin thumbnails are never indexed and the operator wants them now.
                  unoptimized
                />
                {index === 0 && (
                  <span className="absolute top-1 left-1 rounded-sm bg-forest-800 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
                    Main
                  </span>
                )}
              </div>

              <form action={removeProductImageForm} className="mt-2">
                <input type="hidden" name="productId" value={productId} />
                <input type="hidden" name="imageId" value={image.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-sm text-xs text-error hover:underline"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
