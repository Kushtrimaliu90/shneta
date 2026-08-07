'use client';

import { useActionState, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { clientEnv } from '@/lib/env.client';
import { storageUrl } from '@/lib/storage';
import { pickLocale } from '@/lib/i18n';
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '@/features/hero/admin-schemas';
import { createHeroUploadUrl, saveHeroSlide } from '@/features/hero/admin-actions';
import { Feedback } from '@/features/hero/components/hero-admin';
import type { AdminHeroSlide } from '@/features/hero/admin-queries';
import { cn } from '@/lib/utils';

/**
 * The slide form: every text field as an SQ/EN pair, both images, the schedule, and a live preview.
 *
 * ── Uploads go straight to Storage ──
 *
 * A server action's request body is capped at 1 MB by default and these are hero photographs, so the
 * action mints a **signed upload URL** and the browser sends the bytes to Supabase directly — the
 * same route `media-actions.ts` takes for product images.
 *
 * Validation happens three times and none of it is redundant: here, so the person is told before
 * four megabytes leave their laptop; in the action, because a client check is a courtesy rather than
 * a control; and at the **bucket**, which enforces its own size ceiling and MIME allowlist against a
 * request that skipped both.
 *
 * ── The preview is the form state, not a saved row ──
 *
 * It re-renders from what is currently typed, at a phone width and a desktop width side by side, so
 * "does this headline wrap badly on mobile" is answerable before saving rather than after publishing.
 */
export function SlideEditor({
  slide,
  onDone,
}: {
  slide: AdminHeroSlide | null;
  onDone: () => void;
}) {
  const [state, action] = useActionState(async (previous: Awaited<ReturnType<typeof saveHeroSlide>>, formData: FormData) => {
    const result = await saveHeroSlide(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null);

  const [desktopPath, setDesktopPath] = useState(slide?.imageDesktopPath ?? '');
  const [mobilePath, setMobilePath] = useState(slide?.imageMobilePath ?? '');
  const [uploading, setUploading] = useState<'desktop' | 'mobile' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Mirrored into state purely so the preview can react as the operator types.
  const [preview, setPreview] = useState({
    eyebrow: pickLocale(slide?.eyebrow ?? {}, 'en'),
    headline: pickLocale(slide?.headline ?? {}, 'en'),
    subhead: pickLocale(slide?.subhead ?? {}, 'en'),
    cta: pickLocale(slide?.ctaPrimaryLabel ?? {}, 'en'),
    variant: slide?.textVariant ?? ('dark' as 'light' | 'dark'),
  });

  async function upload(file: File, slot: 'desktop' | 'mobile') {
    setUploadError(null);

    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setUploadError('Images must be JPG, PNG, WebP or AVIF.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setUploadError('That image is over 4 MB.');
      return;
    }

    setUploading(slot);
    try {
      const form = new FormData();
      form.set('contentType', file.type);
      form.set('size', String(file.size));

      const signed = await createHeroUploadUrl(null, form);
      if (!signed?.ok || !signed.data.path || !signed.data.token) {
        setUploadError('The upload could not be started. Try again.');
        return;
      }

      const supabase = createBrowserClient(
        clientEnv.NEXT_PUBLIC_SUPABASE_URL,
        clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      );
      const { error } = await supabase.storage
        .from('content')
        .uploadToSignedUrl(signed.data.path, signed.data.token, file);

      if (error) {
        setUploadError(error.message);
        return;
      }

      if (slot === 'desktop') setDesktopPath(signed.data.path);
      else setMobilePath(signed.data.path);
    } finally {
      setUploading(null);
    }
  }

  const desktopSrc = desktopPath
    ? desktopPath.startsWith('/')
      ? desktopPath
      : storageUrl('content', desktopPath)
    : null;

  return (
    <Card>
      <form action={action} className="flex flex-col gap-6 p-5">
        {slide && <input type="hidden" name="id" value={slide.id} />}
        <input type="hidden" name="imageDesktopPath" value={desktopPath} />
        <input type="hidden" name="imageMobilePath" value={mobilePath} />

        <Pair
          label="Eyebrow"
          nameSq="eyebrowSq"
          nameEn="eyebrowEn"
          slide={slide}
          field="eyebrow"
          onEn={(value) => setPreview((p) => ({ ...p, eyebrow: value }))}
        />
        <Pair
          label="Headline"
          nameSq="headlineSq"
          nameEn="headlineEn"
          slide={slide}
          field="headline"
          required
          onEn={(value) => setPreview((p) => ({ ...p, headline: value }))}
        />
        <Pair
          label="Subhead"
          nameSq="subheadSq"
          nameEn="subheadEn"
          slide={slide}
          field="subhead"
          textarea
          onEn={(value) => setPreview((p) => ({ ...p, subhead: value }))}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Pair
            label="Primary CTA label"
            nameSq="ctaPrimaryLabelSq"
            nameEn="ctaPrimaryLabelEn"
            slide={slide}
            field="ctaPrimaryLabel"
            required
            onEn={(value) => setPreview((p) => ({ ...p, cta: value }))}
          />
          <label htmlFor="cta-primary-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Primary CTA link</span>
            <Input id="cta-primary-href" name="ctaPrimaryHref" defaultValue={slide?.ctaPrimaryHref ?? ''} placeholder="/shop" />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Pair
            label="Secondary CTA label"
            nameSq="ctaSecondaryLabelSq"
            nameEn="ctaSecondaryLabelEn"
            slide={slide}
            field="ctaSecondaryLabel"
          />
          <label htmlFor="cta-secondary-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Secondary CTA link</span>
            <Input
              id="cta-secondary-href"
              name="ctaSecondaryHref"
              defaultValue={slide?.ctaSecondaryHref ?? ''}
              placeholder="/biohack"
            />
          </label>
        </div>

        <ImageSlot
          title="Desktop image"
          hint="Required to publish."
          path={desktopPath}
          busy={uploading === 'desktop'}
          onFile={(file) => void upload(file, 'desktop')}
          altSqName="imageDesktopAltSq"
          altEnName="imageDesktopAltEn"
          altSq={pickLocale(slide?.imageDesktopAlt ?? {}, 'sq')}
          altEn={pickLocale(slide?.imageDesktopAlt ?? {}, 'en')}
        />
        <ImageSlot
          title="Mobile image"
          hint="Optional — falls back to the desktop crop."
          path={mobilePath}
          busy={uploading === 'mobile'}
          onFile={(file) => void upload(file, 'mobile')}
          altSqName="imageMobileAltSq"
          altEnName="imageMobileAltEn"
          altSq={pickLocale(slide?.imageMobileAlt ?? {}, 'sq')}
          altEn={pickLocale(slide?.imageMobileAlt ?? {}, 'en')}
        />

        {uploadError && <Alert tone="error">{uploadError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-3">
          <label htmlFor="slide-variant" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Text style</span>
            <select
              id="slide-variant"
              name="textVariant"
              defaultValue={slide?.textVariant ?? 'dark'}
              onChange={(event) =>
                setPreview((p) => ({ ...p, variant: event.target.value === 'light' ? 'light' : 'dark' }))
              }
              className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm"
            >
              <option value="dark">Dark text on cream</option>
              <option value="light">Light text on forest</option>
            </select>
          </label>
          <label htmlFor="slide-start" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Show from</span>
            <Input
              id="slide-start"
              name="startAt"
              type="datetime-local"
              defaultValue={toLocalInput(slide?.startAt)}
            />
          </label>
          <label htmlFor="slide-end" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Show until</span>
            <Input id="slide-end" name="endAt" type="datetime-local" defaultValue={toLocalInput(slide?.endAt)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="isPinned"
              defaultChecked={slide?.isPinned ?? false}
              className="size-4"
            />
            Pin as first slide
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="status"
              value="published"
              defaultChecked={slide?.status === 'published'}
              className="size-4"
            />
            Published
          </label>
        </div>

        <Preview preview={preview} desktopSrc={desktopSrc} />

        <div className="flex gap-2">
          <SubmitButton>Save slide</SubmitButton>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>

        <Feedback state={state} />
      </form>
    </Card>
  );
}

/** SQ and EN side by side, which is the only arrangement where a missing translation is obvious. */
function Pair({
  label,
  nameSq,
  nameEn,
  slide,
  field,
  required,
  textarea,
  onEn,
}: {
  label: string;
  nameSq: string;
  nameEn: string;
  slide: AdminHeroSlide | null;
  field: 'eyebrow' | 'headline' | 'subhead' | 'ctaPrimaryLabel' | 'ctaSecondaryLabel';
  required?: boolean;
  textarea?: boolean;
  onEn?: (value: string) => void;
}) {
  const box =
    'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-forest-600';

  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium text-ink-900">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </legend>

      <label htmlFor={nameSq} className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-ink-500">Albanian</span>
        {textarea ? (
          <textarea id={nameSq} name={nameSq} rows={3} defaultValue={pickLocale(slide?.[field] ?? {}, 'sq')} className={box} />
        ) : (
          <input id={nameSq} name={nameSq} defaultValue={pickLocale(slide?.[field] ?? {}, 'sq')} className={cn(box, 'h-11')} />
        )}
      </label>

      <label htmlFor={nameEn} className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-ink-500">English</span>
        {textarea ? (
          <textarea
            id={nameEn}
            name={nameEn}
            rows={3}
            defaultValue={pickLocale(slide?.[field] ?? {}, 'en')}
            onChange={(event) => onEn?.(event.target.value)}
            className={box}
          />
        ) : (
          <input
            id={nameEn}
            name={nameEn}
            defaultValue={pickLocale(slide?.[field] ?? {}, 'en')}
            onChange={(event) => onEn?.(event.target.value)}
            className={cn(box, 'h-11')}
          />
        )}
      </label>
    </fieldset>
  );
}

function ImageSlot({
  title,
  hint,
  path,
  busy,
  onFile,
  altSqName,
  altEnName,
  altSq,
  altEn,
}: {
  title: string;
  hint: string;
  path: string;
  busy: boolean;
  onFile: (file: File) => void;
  altSqName: string;
  altEnName: string;
  altSq: string;
  altEn: string;
}) {
  const src = path ? (path.startsWith('/') ? path : storageUrl('content', path)) : null;

  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="text-xs text-ink-500">{hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="h-20 w-32 overflow-hidden rounded-md border border-line bg-cream">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src && <img src={src} alt="" className="size-full object-cover" />}
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm text-ink-900 hover:bg-forest-50">
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          {busy ? 'Uploading…' : 'Choose image'}
          <input
            type="file"
            accept={IMAGE_TYPES.join(',')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              // Reset so choosing the same file twice still fires a change.
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {/*
        Alt text is required whenever there is an image — enforced by the schema and by a check
        constraint, not merely asked for here. The Albanian one is the required half because it is
        the default locale; English falls back to it.
      */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label htmlFor={altSqName} className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-ink-500">Alt text — Albanian{path && ' *'}</span>
          <Input id={altSqName} name={altSqName} defaultValue={altSq} maxLength={200} />
        </label>
        <label htmlFor={altEnName} className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-ink-500">Alt text — English</span>
          <Input id={altEnName} name={altEnName} defaultValue={altEn} maxLength={200} />
        </label>
      </div>
    </div>
  );
}

function Preview({
  preview,
  desktopSrc,
}: {
  preview: { eyebrow: string; headline: string; subhead: string; cta: string; variant: 'light' | 'dark' };
  desktopSrc: string | null;
}) {
  const light = preview.variant === 'light';

  const body = (
    <div className={cn('flex h-full flex-col justify-center gap-2 p-4', light ? 'bg-forest-950' : 'bg-cream')}>
      {preview.eyebrow && (
        <p className={cn('text-[10px] font-semibold uppercase tracking-wide', light ? 'text-lime-400' : 'text-forest-700')}>
          {preview.eyebrow}
        </p>
      )}
      <p className={cn('font-display text-lg leading-tight font-semibold', light ? 'text-cream' : 'text-forest-900')}>
        {preview.headline || 'Headline'}
      </p>
      {preview.subhead && (
        <p className={cn('line-clamp-3 text-xs', light ? 'text-cream/70' : 'text-ink-600')}>
          {preview.subhead}
        </p>
      )}
      {preview.cta && (
        <span
          className={cn(
            'mt-1 inline-block w-fit rounded-md px-3 py-1.5 text-xs font-medium',
            light ? 'bg-lime-500 text-lime-950' : 'bg-forest-800 text-cream',
          )}
        >
          {preview.cta}
        </span>
      )}
    </div>
  );

  return (
    <div>
      <p className="text-sm font-medium text-ink-900">Preview</p>
      <p className="text-xs text-ink-500">English copy, at a phone width and a desktop width.</p>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div>
          <p className="mb-1 text-xs text-ink-500">393 px</p>
          <div className="h-64 w-[196px] overflow-hidden rounded-lg border border-line">
            <div className="grid h-full grid-rows-2">
              <div className="overflow-hidden bg-forest-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {desktopSrc && <img src={desktopSrc} alt="" className="size-full object-cover" />}
              </div>
              {body}
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs text-ink-500">1280 px</p>
          <div className="h-64 w-[420px] overflow-hidden rounded-lg border border-line">
            <div className="grid h-full grid-cols-[1.05fr_0.95fr]">
              {body}
              <div className="overflow-hidden bg-forest-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {desktopSrc && <img src={desktopSrc} alt="" className="size-full object-cover" />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time; the row stores UTC ISO. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-forest-500/40 bg-forest-50/30">{children}</div>;
}
