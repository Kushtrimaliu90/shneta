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
  /**
   * What the operator last typed, kept so a rejected save does not wipe the form.
   *
   * React 19 **resets an uncontrolled form after a function `action` completes** — success or
   * failure, it does not distinguish. So a slide that failed validation came back blank and had to be
   * retyped from scratch, which is the worst possible response to "one field is wrong": it punishes
   * the person hardest when they are closest to being finished.
   *
   * The fix is to capture the submission and re-seed from it. `attempt` bumps on every failure and
   * keys the fieldset, so the inputs remount carrying the echoed values rather than the row's — an
   * uncontrolled input reads `defaultValue` only when it mounts, so without the key the new defaults
   * would be ignored.
   */
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [state, action] = useActionState(
    async (previous: Awaited<ReturnType<typeof saveHeroSlide>>, formData: FormData) => {
      const submitted = Object.fromEntries(
        [...formData.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '']),
      );

      const result = await saveHeroSlide(previous, formData);
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

  /** The last submitted value for a field, falling back to the saved row. */
  const val = (name: string, fallback: string): string => draft?.[name] ?? fallback;
  /** Checkboxes are absent from FormData when unticked, so a draft means "not ticked". */
  const checked = (name: string, fallback: boolean): boolean =>
    draft ? draft[name] !== undefined : fallback;

  const fieldErrors = state?.ok === false ? (state.fieldErrors ?? {}) : {};
  const errorsFor = (name: string): string[] | undefined => fieldErrors[name];

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
      <form action={action} key={attempt} className="flex flex-col gap-6 p-5">
        {slide && <input type="hidden" name="id" value={slide.id} />}
        <input type="hidden" name="imageDesktopPath" value={desktopPath} />
        <input type="hidden" name="imageMobilePath" value={mobilePath} />

        <Pair
          label="Eyebrow"
          nameSq="eyebrowSq"
          nameEn="eyebrowEn"
          slide={slide}
          field="eyebrow"
          draft={draft}
          fieldErrors={fieldErrors}
          onEn={(value) => setPreview((p) => ({ ...p, eyebrow: value }))}
        />
        <Pair
          label="Headline"
          nameSq="headlineSq"
          nameEn="headlineEn"
          slide={slide}
          field="headline"
          required
          draft={draft}
          fieldErrors={fieldErrors}
          onEn={(value) => setPreview((p) => ({ ...p, headline: value }))}
        />
        <Pair
          label="Subhead"
          nameSq="subheadSq"
          nameEn="subheadEn"
          slide={slide}
          field="subhead"
          textarea
          draft={draft}
          fieldErrors={fieldErrors}
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
            draft={draft}
            fieldErrors={fieldErrors}
            onEn={(value) => setPreview((p) => ({ ...p, cta: value }))}
          />
          <label htmlFor="cta-primary-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Primary CTA link</span>
            <Input
              id="cta-primary-href"
              name="ctaPrimaryHref"
              defaultValue={val('ctaPrimaryHref', slide?.ctaPrimaryHref ?? '')}
              placeholder="/shop"
              aria-invalid={Boolean(errorsFor('ctaPrimaryHref'))}
            />
            <FieldError id="ctaPrimaryHref-error" messages={errorsFor('ctaPrimaryHref')} />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Pair
            label="Secondary CTA label"
            nameSq="ctaSecondaryLabelSq"
            nameEn="ctaSecondaryLabelEn"
            slide={slide}
            field="ctaSecondaryLabel"
            draft={draft}
            fieldErrors={fieldErrors}
          />
          <label htmlFor="cta-secondary-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Secondary CTA link</span>
            <Input
              id="cta-secondary-href"
              name="ctaSecondaryHref"
              defaultValue={val('ctaSecondaryHref', slide?.ctaSecondaryHref ?? '')}
              placeholder="/biohack"
              aria-invalid={Boolean(errorsFor('ctaSecondaryHref'))}
            />
            <FieldError id="ctaSecondaryHref-error" messages={errorsFor('ctaSecondaryHref')} />
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
          altSq={val('imageDesktopAltSq', pickLocale(slide?.imageDesktopAlt ?? {}, 'sq'))}
          altErrorSq={errorsFor('imageDesktopAltSq')}
          altEn={val('imageDesktopAltEn', pickLocale(slide?.imageDesktopAlt ?? {}, 'en'))}
        />
        <ImageSlot
          title="Mobile image"
          hint="Optional — falls back to the desktop crop."
          path={mobilePath}
          busy={uploading === 'mobile'}
          onFile={(file) => void upload(file, 'mobile')}
          altSqName="imageMobileAltSq"
          altEnName="imageMobileAltEn"
          altSq={val('imageMobileAltSq', pickLocale(slide?.imageMobileAlt ?? {}, 'sq'))}
          altErrorSq={errorsFor('imageMobileAltSq')}
          altEn={val('imageMobileAltEn', pickLocale(slide?.imageMobileAlt ?? {}, 'en'))}
        />

        {uploadError && <Alert tone="error">{uploadError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-3">
          <label htmlFor="slide-variant" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Text style</span>
            <select
              id="slide-variant"
              name="textVariant"
              defaultValue={val('textVariant', slide?.textVariant ?? 'dark')}
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
              defaultValue={val('startAt', toLocalInput(slide?.startAt))}
            />
          </label>
          <label htmlFor="slide-end" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Show until</span>
            <Input
              id="slide-end"
              name="endAt"
              type="datetime-local"
              defaultValue={val('endAt', toLocalInput(slide?.endAt))}
              aria-invalid={Boolean(errorsFor('endAt'))}
            />
            <FieldError id="endAt-error" messages={errorsFor('endAt')} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="isPinned"
              defaultChecked={checked('isPinned', slide?.isPinned ?? false)}
              className="size-4"
            />
            Pin as first slide
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="status"
              value="published"
              defaultChecked={checked('status', slide?.status === 'published')}
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

        <ErrorSummary state={state} fieldErrors={fieldErrors} />
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
  draft,
  fieldErrors,
}: {
  label: string;
  nameSq: string;
  nameEn: string;
  slide: AdminHeroSlide | null;
  field: 'eyebrow' | 'headline' | 'subhead' | 'ctaPrimaryLabel' | 'ctaSecondaryLabel';
  required?: boolean;
  textarea?: boolean;
  onEn?: (value: string) => void;
  draft: Record<string, string> | null;
  fieldErrors: Record<string, string[]>;
}) {
  const seed = (name: string, fallback: string) => draft?.[name] ?? fallback;
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
          <textarea
            id={nameSq}
            name={nameSq}
            rows={3}
            defaultValue={seed(nameSq, pickLocale(slide?.[field] ?? {}, 'sq'))}
            aria-invalid={Boolean(fieldErrors[nameSq])}
            aria-describedby={fieldErrors[nameSq] ? `${nameSq}-error` : undefined}
            className={cn(box, fieldErrors[nameSq] && invalid)}
          />
        ) : (
          <input
            id={nameSq}
            name={nameSq}
            defaultValue={seed(nameSq, pickLocale(slide?.[field] ?? {}, 'sq'))}
            aria-invalid={Boolean(fieldErrors[nameSq])}
            aria-describedby={fieldErrors[nameSq] ? `${nameSq}-error` : undefined}
            className={cn(box, 'h-11', fieldErrors[nameSq] && invalid)}
          />
        )}
        <FieldError id={`${nameSq}-error`} messages={fieldErrors[nameSq]} />
      </label>

      <label htmlFor={nameEn} className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-ink-500">English</span>
        {textarea ? (
          <textarea
            id={nameEn}
            name={nameEn}
            rows={3}
            defaultValue={seed(nameEn, pickLocale(slide?.[field] ?? {}, 'en'))}
            onChange={(event) => onEn?.(event.target.value)}
            aria-invalid={Boolean(fieldErrors[nameEn])}
            aria-describedby={fieldErrors[nameEn] ? `${nameEn}-error` : undefined}
            className={cn(box, fieldErrors[nameEn] && invalid)}
          />
        ) : (
          <input
            id={nameEn}
            name={nameEn}
            defaultValue={seed(nameEn, pickLocale(slide?.[field] ?? {}, 'en'))}
            onChange={(event) => onEn?.(event.target.value)}
            aria-invalid={Boolean(fieldErrors[nameEn])}
            aria-describedby={fieldErrors[nameEn] ? `${nameEn}-error` : undefined}
            className={cn(box, 'h-11', fieldErrors[nameEn] && invalid)}
          />
        )}
        <FieldError id={`${nameEn}-error`} messages={fieldErrors[nameEn]} />
      </label>
    </fieldset>
  );
}

/** A red border, so "highlighted fields" means something. */
const invalid = 'border-error focus:ring-error';

/**
 * The message under a field.
 *
 * The action has always returned `fieldErrors` — `fromFieldErrors` builds them from the Zod flatten
 * and they travelled all the way to the component, where nothing rendered them. So the panel said
 * "Check the highlighted fields" and highlighted nothing, which is a worse failure than no message at
 * all: it tells the operator there is something to find and then hides it.
 *
 * `role="alert"` so the text is announced when it appears, and it is wired to the input through
 * `aria-describedby` rather than merely sitting near it.
 */
function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <span id={id} role="alert" className="text-xs text-error">
      {messages.join(' ')}
    </span>
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
  altErrorSq,
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
  altErrorSq?: string[];
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
          <Input
            id={altSqName}
            name={altSqName}
            defaultValue={altSq}
            maxLength={200}
            aria-invalid={Boolean(altErrorSq)}
          />
          <FieldError id={`${altSqName}-error`} messages={altErrorSq} />
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

/** Field name → what the operator called it, so the summary reads like the form. */
const FIELD_LABELS: Record<string, string> = {
  eyebrowSq: 'Eyebrow (Albanian)',
  eyebrowEn: 'Eyebrow (English)',
  headlineSq: 'Headline (Albanian)',
  headlineEn: 'Headline (English)',
  subheadSq: 'Subhead (Albanian)',
  subheadEn: 'Subhead (English)',
  ctaPrimaryLabelSq: 'Primary CTA label (Albanian)',
  ctaPrimaryLabelEn: 'Primary CTA label (English)',
  ctaPrimaryHref: 'Primary CTA link',
  ctaSecondaryLabelSq: 'Secondary CTA label (Albanian)',
  ctaSecondaryLabelEn: 'Secondary CTA label (English)',
  ctaSecondaryHref: 'Secondary CTA link',
  imageDesktopPath: 'Desktop image',
  imageDesktopAltSq: 'Desktop alt text (Albanian)',
  imageMobileAltSq: 'Mobile alt text (Albanian)',
  startAt: 'Show from',
  endAt: 'Show until',
};

/**
 * What is wrong, by name, above the buttons.
 *
 * The panel used to say "Check the highlighted fields" and highlight nothing — the worst of both,
 * because it tells the operator there is something to find and then hides it. The field-level
 * messages are the real fix; this is the index, because the form is long enough that a red border
 * three screens up is easy to scroll past.
 *
 * Only rendered on failure, and it names the fields rather than restating the generic sentence.
 * `role="alert"` so a screen-reader user hears the list rather than discovering it.
 */
function ErrorSummary({
  state,
  fieldErrors,
}: {
  state: Awaited<ReturnType<typeof saveHeroSlide>>;
  fieldErrors: Record<string, string[]>;
}) {
  if (!state) return null;

  if (state.ok) {
    return (
      <Alert tone="success" className="mt-1">
        {state.data.message ?? 'Saved.'}
      </Alert>
    );
  }

  const named = Object.entries(fieldErrors);

  if (named.length === 0) {
    // No field owns this one — a permission refusal, a pin clash, a database constraint. The shared
    // `Feedback` already translates those into a sentence.
    return <Feedback state={state} />;
  }

  return (
    <Alert tone="error" className="mt-1" title="This slide was not saved">
      <p>Nothing has been lost — your text is still in the form. Fix these and save again:</p>
      <ul className="mt-2 list-disc pl-5">
        {named.map(([field, messages]) => (
          <li key={field}>
            <span className="font-medium">{FIELD_LABELS[field] ?? field}</span> — {messages.join(' ')}
          </li>
        ))}
      </ul>
    </Alert>
  );
}
