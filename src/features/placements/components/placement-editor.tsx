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
import {
  PLACEMENT_IMAGE_MAX_BYTES,
  PLACEMENT_IMAGE_TYPES,
  PLACEMENT_MIN_DESKTOP_WIDTH,
  PLACEMENT_MIN_MOBILE_WIDTH,
} from '@/features/placements/admin-schemas';
import { createPlacementUploadUrl, savePlacement } from '@/features/placements/admin-actions';
import type { AdminPlacement } from '@/features/placements/admin-queries';
import { cn } from '@/lib/utils';

/**
 * The placement form.
 *
 * ── Nothing is lost on a rejected save ──
 *
 * React 19 resets an uncontrolled form after a function `action` completes, success or failure. The
 * hero editor shipped without allowing for that and wiped the operator's work on every validation
 * error; the same pattern is applied here from the start — the submission is captured and re-seeded,
 * keyed on the attempt so the inputs remount carrying the echoed values.
 *
 * ── Dimensions are checked in the browser ──
 *
 * A 5:1 slot at 1200 px on a 2× screen wants 2400 px of source, and a small file renders blurry for
 * somebody who paid. The check happens before the bytes are sent, because the alternative is decoding
 * the image server-side to reject it afterwards. That makes it a *courtesy* rather than a control —
 * the type and size ceilings are enforced by the bucket, which a forged request cannot skip, but a
 * determined caller could upload a small image. The reviewer sees it in the preview before approving.
 */
export function PlacementEditor({
  placement,
  onDone,
}: {
  placement: AdminPlacement | null;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [state, action] = useActionState(
    async (previous: Awaited<ReturnType<typeof savePlacement>>, formData: FormData) => {
      const submitted = Object.fromEntries(
        [...formData.entries()].map(([key, value]) => [
          key,
          typeof value === 'string' ? value : '',
        ]),
      );
      const result = await savePlacement(previous, formData);
      if (result?.ok) {
        onDone();
        return result;
      }
      setDraft(submitted);
      setAttempt((current) => current + 1);
      return result;
    },
    null,
  );

  const [desktopPath, setDesktopPath] = useState(placement?.imageDesktopPath ?? '');
  const [mobilePath, setMobilePath] = useState(placement?.imageMobilePath ?? '');
  const [busy, setBusy] = useState<'desktop' | 'mobile' | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const val = (name: string, fallback: string): string => draft?.[name] ?? fallback;
  const checked = (name: string, fallback: boolean): boolean =>
    draft ? draft[name] !== undefined : fallback;
  const fieldErrors = state?.ok === false ? (state.fieldErrors ?? {}) : {};

  async function upload(file: File, slot: 'desktop' | 'mobile') {
    setUploadError(null);

    if (!(PLACEMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setUploadError('Creatives must be JPG, PNG, WebP or AVIF.');
      return;
    }
    if (file.size > PLACEMENT_IMAGE_MAX_BYTES) {
      setUploadError('That file is over 4 MB.');
      return;
    }

    const minWidth = slot === 'desktop' ? PLACEMENT_MIN_DESKTOP_WIDTH : PLACEMENT_MIN_MOBILE_WIDTH;
    try {
      const bitmap = await createImageBitmap(file);
      const { width } = bitmap;
      bitmap.close();
      if (width < minWidth) {
        setUploadError(
          `That creative is ${width}px wide. The ${slot} slot needs at least ${minWidth}px.`,
        );
        return;
      }
    } catch {
      setUploadError('That file could not be read as an image.');
      return;
    }

    setBusy(slot);
    try {
      const form = new FormData();
      form.set('contentType', file.type);
      form.set('size', String(file.size));

      const signed = await createPlacementUploadUrl(null, form);
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
      setBusy(null);
    }
  }

  const src = (path: string) =>
    path ? (path.startsWith('/') ? path : storageUrl('content', path)) : null;

  const box = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-900';

  return (
    <div className="rounded-lg border border-forest-500/40 bg-forest-50/30">
      <form action={action} key={attempt} className="flex flex-col gap-5 p-5">
        {placement && <input type="hidden" name="id" value={placement.id} />}
        <input type="hidden" name="imageDesktopPath" value={desktopPath} />
        <input type="hidden" name="imageMobilePath" value={mobilePath} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="advertiserName"
            label="Advertiser"
            required
            errors={fieldErrors.advertiserName}
          >
            <Input
              id="advertiserName"
              name="advertiserName"
              defaultValue={val('advertiserName', placement?.advertiserName ?? '')}
              aria-invalid={Boolean(fieldErrors.advertiserName)}
            />
          </Field>
          <Field id="internalNote" label="Internal note">
            <Input
              id="internalNote"
              name="internalNote"
              defaultValue={val('internalNote', placement?.internalNote ?? '')}
              placeholder="Invoice reference, contact, anything"
            />
          </Field>
        </div>

        <Bilingual
          label="Headline"
          nameSq="headlineSq"
          nameEn="headlineEn"
          sq={val('headlineSq', pickLocale(placement?.headline ?? {}, 'sq'))}
          en={val('headlineEn', pickLocale(placement?.headline ?? {}, 'en'))}
          errors={fieldErrors}
          box={box}
        />
        <Bilingual
          label="Subhead"
          nameSq="subheadSq"
          nameEn="subheadEn"
          sq={val('subheadSq', pickLocale(placement?.subhead ?? {}, 'sq'))}
          en={val('subheadEn', pickLocale(placement?.subhead ?? {}, 'en'))}
          errors={fieldErrors}
          box={box}
        />
        <Bilingual
          label="CTA label"
          nameSq="ctaLabelSq"
          nameEn="ctaLabelEn"
          sq={val('ctaLabelSq', pickLocale(placement?.ctaLabel ?? {}, 'sq'))}
          en={val('ctaLabelEn', pickLocale(placement?.ctaLabel ?? {}, 'en'))}
          errors={fieldErrors}
          box={box}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="destinationUrl"
            label="Destination"
            required
            hint="https://… or a site path like /shop"
            errors={fieldErrors.destinationUrl}
          >
            <Input
              id="destinationUrl"
              name="destinationUrl"
              defaultValue={val('destinationUrl', placement?.destinationUrl ?? '')}
              aria-invalid={Boolean(fieldErrors.destinationUrl)}
            />
          </Field>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                name="openInNewTab"
                defaultChecked={checked('openInNewTab', placement?.openInNewTab ?? false)}
                className="size-4"
              />
              Open in a new tab
            </label>
          </div>
        </div>

        <CreativeSlot
          title="Desktop creative"
          hint={`5:1. At least ${PLACEMENT_MIN_DESKTOP_WIDTH}px wide. Required to approve.`}
          path={desktopPath}
          preview={src(desktopPath)}
          busy={busy === 'desktop'}
          onFile={(file) => void upload(file, 'desktop')}
          altSqName="imageDesktopAltSq"
          altEnName="imageDesktopAltEn"
          altSq={val('imageDesktopAltSq', pickLocale(placement?.imageDesktopAlt ?? {}, 'sq'))}
          altEn={val('imageDesktopAltEn', pickLocale(placement?.imageDesktopAlt ?? {}, 'en'))}
          altError={fieldErrors.imageDesktopAltSq}
          aspect="aspect-[5/1]"
        />
        <CreativeSlot
          title="Mobile creative"
          hint={`2:1. At least ${PLACEMENT_MIN_MOBILE_WIDTH}px wide. Falls back to desktop if empty.`}
          path={mobilePath}
          preview={src(mobilePath)}
          busy={busy === 'mobile'}
          onFile={(file) => void upload(file, 'mobile')}
          altSqName="imageMobileAltSq"
          altEnName="imageMobileAltEn"
          altSq={val('imageMobileAltSq', pickLocale(placement?.imageMobileAlt ?? {}, 'sq'))}
          altEn={val('imageMobileAltEn', pickLocale(placement?.imageMobileAlt ?? {}, 'en'))}
          altError={fieldErrors.imageMobileAltSq}
          aspect="aspect-[2/1]"
        />

        {uploadError && <Alert tone="error">{uploadError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="targetCategorySlugs"
            label="Only these categories"
            hint="Comma separated. Empty = all pages."
          >
            <Input
              id="targetCategorySlugs"
              name="targetCategorySlugs"
              defaultValue={val(
                'targetCategorySlugs',
                (placement?.targetCategorySlugs ?? []).join(', '),
              )}
              placeholder="sports-nutrition, proteina"
            />
          </Field>
          <Field
            id="targetBrandSlugs"
            label="Only these brand pages"
            hint="Comma separated. Empty = all pages."
          >
            <Input
              id="targetBrandSlugs"
              name="targetBrandSlugs"
              defaultValue={val('targetBrandSlugs', (placement?.targetBrandSlugs ?? []).join(', '))}
              placeholder="solgar"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="weight"
            label="Weight"
            hint="1–100. Higher goes first."
            errors={fieldErrors.weight}
          >
            <Input
              id="weight"
              name="weight"
              type="number"
              min={1}
              max={100}
              defaultValue={val('weight', String(placement?.weight ?? 1))}
            />
          </Field>
          <Field id="startAt" label="Runs from">
            <Input
              id="startAt"
              name="startAt"
              type="datetime-local"
              defaultValue={val('startAt', toLocalInput(placement?.startAt))}
            />
          </Field>
          <Field id="endAt" label="Runs until" errors={fieldErrors.endAt}>
            <Input
              id="endAt"
              name="endAt"
              type="datetime-local"
              defaultValue={val('endAt', toLocalInput(placement?.endAt))}
              aria-invalid={Boolean(fieldErrors.endAt)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-start gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="isPaid"
              defaultChecked={checked('isPaid', placement?.isPaid ?? true)}
              className="mt-0.5 size-4"
            />
            <span>
              Paid placement
              <span className="mt-0.5 block text-xs text-ink-500">
                Shows the “Sponsored” label, which cannot be turned off separately. Untick only for
                BioCode’s own promotions.
              </span>
            </span>
          </label>

          <label htmlFor="status" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Status</span>
            <select
              id="status"
              name="status"
              defaultValue={val('status', placement?.status ?? 'draft')}
              className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
            >
              <option value="draft">Draft</option>
              <option value="pending_review">Pending review</option>
              <option value="approved">Approved — live</option>
            </select>
          </label>
        </div>

        <Preview desktop={src(desktopPath)} mobile={src(mobilePath) ?? src(desktopPath)} />

        <div className="flex gap-2">
          <SubmitButton>Save placement</SubmitButton>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>

        {state && !state.ok && <Summary state={state} fieldErrors={fieldErrors} />}
        {state?.ok && <Alert tone="success">{state.data.message ?? 'Saved.'}</Alert>}
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  required,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink-900">
        {label}
        {required && <span className="ml-0.5 text-error">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
      {errors && errors.length > 0 && (
        <span role="alert" className="text-xs text-error">
          {errors.join(' ')}
        </span>
      )}
    </label>
  );
}

function Bilingual({
  label,
  nameSq,
  nameEn,
  sq,
  en,
  errors,
  box,
}: {
  label: string;
  nameSq: string;
  nameEn: string;
  sq: string;
  en: string;
  errors: Record<string, string[]>;
  box: string;
}) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium text-ink-900">{label}</legend>
      <label htmlFor={nameSq} className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-ink-500">Albanian</span>
        <input
          id={nameSq}
          name={nameSq}
          defaultValue={sq}
          className={cn(box, 'h-11', errors[nameSq] && 'border-error')}
        />
        {errors[nameSq] && (
          <span role="alert" className="text-xs text-error">
            {errors[nameSq].join(' ')}
          </span>
        )}
      </label>
      <label htmlFor={nameEn} className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-ink-500">English</span>
        <input
          id={nameEn}
          name={nameEn}
          defaultValue={en}
          className={cn(box, 'h-11', errors[nameEn] && 'border-error')}
        />
        {errors[nameEn] && (
          <span role="alert" className="text-xs text-error">
            {errors[nameEn].join(' ')}
          </span>
        )}
      </label>
    </fieldset>
  );
}

function CreativeSlot({
  title,
  hint,
  path,
  preview,
  busy,
  onFile,
  altSqName,
  altEnName,
  altSq,
  altEn,
  altError,
  aspect,
}: {
  title: string;
  hint: string;
  path: string;
  preview: string | null;
  busy: boolean;
  onFile: (file: File) => void;
  altSqName: string;
  altEnName: string;
  altSq: string;
  altEn: string;
  altError?: string[];
  aspect: string;
}) {
  return (
    <div className="rounded-lg border border-line p-4">
      <p className="text-sm font-medium text-ink-900">{title}</p>
      <p className="text-xs text-ink-500">{hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className={cn('w-56 overflow-hidden rounded-md border border-line bg-cream', aspect)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="" className="size-full object-cover" />}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm text-ink-900 hover:bg-forest-50">
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          {busy ? 'Uploading…' : 'Choose creative'}
          <input
            type="file"
            accept={PLACEMENT_IMAGE_TYPES.join(',')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label htmlFor={altSqName} className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-ink-500">Alt text — Albanian{path && ' *'}</span>
          <Input
            id={altSqName}
            name={altSqName}
            defaultValue={altSq}
            maxLength={200}
            aria-invalid={Boolean(altError)}
          />
          {altError && (
            <span role="alert" className="text-xs text-error">
              {altError.join(' ')}
            </span>
          )}
        </label>
        <label htmlFor={altEnName} className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-ink-500">Alt text — English</span>
          <Input id={altEnName} name={altEnName} defaultValue={altEn} maxLength={200} />
        </label>
      </div>
    </div>
  );
}

/** The slot as a shopper sees it, at both widths, before anyone approves it. */
function Preview({ desktop, mobile }: { desktop: string | null; mobile: string | null }) {
  if (!desktop) return null;
  return (
    <div>
      <p className="text-sm font-medium text-ink-900">Preview</p>
      <p className="text-xs text-ink-500">
        The Sponsored label is added automatically on paid placements and sits outside the creative,
        so it stays legible whatever is uploaded.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div>
          <p className="mb-1 text-xs text-ink-500">1280 px</p>
          <div className="relative aspect-[5/1] w-[420px] overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={desktop} alt="" className="size-full object-cover" />
            <span className="absolute top-1.5 right-1.5 rounded-sm bg-ink-900/85 px-1.5 py-0.5 font-ui text-[10px] font-semibold tracking-wide text-cream uppercase">
              Sponsored
            </span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-ink-500">393 px</p>
          <div className="relative aspect-[2/1] w-[196px] overflow-hidden rounded-lg border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mobile && <img src={mobile} alt="" className="size-full object-cover" />}
            <span className="absolute top-1.5 right-1.5 rounded-sm bg-ink-900/85 px-1.5 py-0.5 font-ui text-[10px] font-semibold tracking-wide text-cream uppercase">
              Sponsored
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Summary({
  state,
  fieldErrors,
}: {
  state: Awaited<ReturnType<typeof savePlacement>>;
  fieldErrors: Record<string, string[]>;
}) {
  if (!state || state.ok) return null;
  const named = Object.entries(fieldErrors);

  if (named.length === 0) {
    return (
      <Alert tone="error">
        {state.error === 'admin.errors.forbidden'
          ? 'Your role cannot manage sponsored placements.'
          : state.error === 'admin.placements.errors.notApprovable'
            ? 'A placement needs a desktop creative before it can be approved.'
            : 'Something went wrong. Try again.'}
      </Alert>
    );
  }

  return (
    <Alert tone="error" title="This placement was not saved">
      <p>Nothing has been lost — your work is still in the form. Fix these and save again:</p>
      <ul className="mt-2 list-disc pl-5">
        {named.map(([field, messages]) => (
          <li key={field}>
            <span className="font-medium">{field}</span> — {messages.join(' ')}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
