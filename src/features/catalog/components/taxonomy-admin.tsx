'use client';

import { useActionState, useRef, useState } from 'react';
import Image from 'next/image';
import { Plus, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { RemoveControl } from '@/components/ui/remove-control';
import {
  attachBrandLogo,
  createBrandLogoUploadUrl,
  removeTaxonomy,
  saveTaxonomy,
  toggleTaxonomyActive,
  type TaxonomyErrorKey,
  type TaxonomyKind,
  type TaxonomyState,
} from '@/features/catalog/taxonomy-actions';
import { CLAIMS_REMINDER, TAXONOMY_CONFIG } from '@/features/catalog/taxonomy-config';
import type { TaxonomyRow } from '@/features/catalog/taxonomy-queries';
import { cn } from '@/lib/utils';

/**
 * docs/06 §4–§7 — one screen serving brands, categories, health goals and ingredients.
 *
 * They are the same editing problem: a slug, a name, some prose, an order, an on/off switch.
 * Four bespoke pages would each grow their own idea of what a validation error looks like, and
 * three of them would end up worse than the one that got attention.
 *
 * What varies comes from `TAXONOMY_CONFIG`, so the differences are a table to read rather than
 * conditionals to trace.
 */

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const areaClass =
  'mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

/** Zod issue codes are identifiers so code can branch on them; a person needs a sentence. */
const FIELD_MESSAGES: Record<string, string> = {
  SLUG_INVALID: 'Lowercase letters, numbers and hyphens only — for example vitamina-d.',
  SLUG_TOO_SHORT: 'At least three characters.',
  INVALID_URL: 'A full address, starting with https://',
  COUNTRY_CODE: 'Two letters, like US or DE.',
  REQUIRED: 'This is required.',
};

/**
 * The shared error map says "product" where these screens mean "brand" or "category".
 *
 * Overridden rather than reworded in place: `CATALOG_ERRORS` is keyed on the union of every
 * catalogue error, which is what makes a missing message a compile error, and the product editor
 * is right to say "product". A partial override keeps both correct.
 */
const TAXONOMY_MESSAGES: Partial<Record<TaxonomyErrorKey, string>> = {
  'admin.catalog.errors.notFound': 'That entry no longer exists.',
  'admin.catalog.errors.slugTaken': 'Another entry already uses that slug.',
};

function message(error: TaxonomyErrorKey): string {
  return TAXONOMY_MESSAGES[error] ?? CATALOG_ERRORS[error];
}

function fieldError(state: TaxonomyState, field: string): string | null {
  if (!state || state.ok) return null;
  const issue = state.fieldErrors?.[field]?.[0];
  return issue ? (FIELD_MESSAGES[issue] ?? issue) : null;
}

export function TaxonomyAdmin({
  kind,
  rows,
  parents = [],
  logoBaseUrl,
}: {
  kind: TaxonomyKind;
  rows: TaxonomyRow[];
  parents?: { id: string; name: string }[];
  logoBaseUrl?: string;
}) {
  const config = TAXONOMY_CONFIG[kind];
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="max-w-4xl">
      {creating ? (
        <TaxonomyForm
          kind={kind}
          parents={parents}
          onDone={() => setCreating(false)}
          logoBaseUrl={logoBaseUrl}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className={buttonVariants({ size: 'sm' })}
        >
          <Plus className="size-4" aria-hidden="true" />
          New {config.singular}
        </button>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">All {config.title.toLowerCase()}</caption>
          <thead>
            <tr className="border-b border-line bg-forest-50 text-left">
              {['Name', 'Slug', config.usageLabel, 'State'].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-3 py-2 font-ui text-xs font-semibold text-ink-600 uppercase"
                >
                  {heading}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-ink-600">
                  No {config.title.toLowerCase()} yet. Create the first one above.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <TaxonomyListRow
                key={row.id}
                kind={kind}
                row={row}
                parents={parents}
                logoBaseUrl={logoBaseUrl}
                isOpen={editing === row.id}
                onToggle={() => setEditing(editing === row.id ? null : row.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * A row and, when open, its editor directly beneath it.
 *
 * The editor is a second `<tr>` rather than a drawer so the row it belongs to stays visible and
 * in place — an operator editing the fourth of twelve categories should not lose their position
 * in the list to do it.
 */
function TaxonomyListRow({
  kind,
  row,
  parents,
  logoBaseUrl,
  isOpen,
  onToggle,
}: {
  kind: TaxonomyKind;
  row: TaxonomyRow;
  parents: { id: string; name: string }[];
  logoBaseUrl?: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const config = TAXONOMY_CONFIG[kind];

  return (
    <>
      <tr className="border-b border-line">
        <td className="px-3 py-2 text-ink-900">
          <span className="inline-flex items-center gap-1.5">
            {/* Depth as an indent: a sub-category reads as sitting inside its parent. */}
            {row.parentId && (
              <span aria-hidden="true" className="text-ink-500">
                ↳
              </span>
            )}
            {row.nameSq || row.slug}
          </span>
          {config.bilingualName && !row.nameEn && (
            <span className="ml-1.5 text-xs text-warning">no English</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-ink-500">{row.slug}</td>
        <td className="px-3 py-2 text-ink-600" data-numeric>
          {row.usageCount}
        </td>
        <td className="px-3 py-2 text-xs">
          {row.isActive ? (
            <span className="text-success">Active</span>
          ) : (
            <span className="text-ink-500">Hidden</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            {isOpen ? 'Close' : 'Edit'}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={5} className="border-b border-line bg-forest-50/40 p-3">
            <TaxonomyForm
              kind={kind}
              row={row}
              parents={parents}
              logoBaseUrl={logoBaseUrl}
              onDone={onToggle}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function TaxonomyForm({
  kind,
  row,
  parents,
  logoBaseUrl,
  onDone,
}: {
  kind: TaxonomyKind;
  row?: TaxonomyRow;
  parents: { id: string; name: string }[];
  logoBaseUrl?: string;
  onDone: () => void;
}) {
  const config = TAXONOMY_CONFIG[kind];
  const [state, formAction] = useActionState<TaxonomyState, FormData>(saveTaxonomy, null);
  const [toggleState, toggleAction] = useActionState<TaxonomyState, FormData>(
    toggleTaxonomyActive,
    null,
  );

  // What was submitted, so a rejected form does not send the operator back to a blank slate.
  const values = state && !state.ok ? (state.values ?? {}) : {};
  const uid = row?.id ?? 'new';

  const value = (field: string, fallback: string | number | null | undefined): string =>
    values[field] ?? (fallback ?? '').toString();

  const failure = [state, toggleState].find((entry) => entry && !entry.ok);

  return (
    <div className="rounded-lg border border-line-strong bg-surface p-4">
      <h2 className="font-display text-sm font-semibold text-forest-900">
        {row ? `Edit ${row.nameSq || row.slug}` : `New ${config.singular}`}
      </h2>

      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="kind" value={kind} />
        {row && <input type="hidden" name="id" value={row.id} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id={`slug-${uid}`}
            name="slug"
            label="Slug"
            required
            defaultValue={value('slug', row?.slug)}
            error={fieldError(state, 'slug')}
            help="Lowercase and hyphens. It is the web address, so changing it breaks existing links."
          />
          <Field
            id={`nameSq-${uid}`}
            name="nameSq"
            label={config.bilingualName ? 'Name (Albanian)' : 'Name'}
            required
            defaultValue={value('nameSq', row?.nameSq)}
            error={fieldError(state, 'nameSq')}
          />
        </div>

        {config.bilingualName && (
          <Field
            id={`nameEn-${uid}`}
            name="nameEn"
            label="Name (English)"
            defaultValue={value('nameEn', row?.nameEn)}
            error={fieldError(state, 'nameEn')}
            help="Left blank, English visitors see the Albanian name."
          />
        )}

        {config.prose.map((prose) => (
          <div key={prose.field} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${prose.field}Sq-${uid}`} className={labelClass}>
                {prose.label} (Albanian)
              </label>
              <textarea
                id={`${prose.field}Sq-${uid}`}
                name={`${prose.field}Sq`}
                rows={prose.rows ?? 3}
                defaultValue={value(`${prose.field}Sq`, row?.prose[prose.field]?.sq)}
                className={areaClass}
              />
              {prose.help && <p className="mt-1 text-xs text-ink-500">{prose.help}</p>}
            </div>
            <div>
              <label htmlFor={`${prose.field}En-${uid}`} className={labelClass}>
                {prose.label} (English)
              </label>
              <textarea
                id={`${prose.field}En-${uid}`}
                name={`${prose.field}En`}
                rows={prose.rows ?? 3}
                defaultValue={value(`${prose.field}En`, row?.prose[prose.field]?.en)}
                className={areaClass}
              />
            </div>
          </div>
        ))}

        {config.hasIngredientFields && <ClaimsReminder />}

        {config.hasBrandFields && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`countryCode-${uid}`}
              name="countryCode"
              label="Country code"
              maxLength={2}
              placeholder="US"
              className="max-w-24 uppercase"
              defaultValue={value('countryCode', row?.countryCode)}
              error={fieldError(state, 'countryCode')}
            />
            <Field
              id={`websiteUrl-${uid}`}
              name="websiteUrl"
              label="Website"
              type="url"
              placeholder="https://…"
              defaultValue={value('websiteUrl', row?.websiteUrl)}
              error={fieldError(state, 'websiteUrl')}
            />
          </div>
        )}

        {config.hasIngredientFields && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`evidence-${uid}`} className={labelClass}>
                Evidence level
              </label>
              <select
                id={`evidence-${uid}`}
                name="evidence"
                // React applies `defaultValue` to a select on mount only, so a re-render after a
                // rejected submit resets it to the first option unless the element is remounted.
                key={`evidence-${value('evidence', row?.evidence)}`}
                defaultValue={value('evidence', row?.evidence)}
                className={inputClass}
              >
                <option value="">Not stated</option>
                {['strong', 'moderate', 'emerging', 'traditional'].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-500">Shown to customers as a labelled badge.</p>
            </div>
            <Field
              id={`ingredientCategory-${uid}`}
              name="ingredientCategory"
              label="Kind"
              placeholder="vitamin"
              defaultValue={value('ingredientCategory', row?.ingredientCategory)}
              error={fieldError(state, 'ingredientCategory')}
              help="vitamin, mineral, herb, probiotic…"
            />
            <Field
              id={`otherNames-${uid}`}
              name="otherNames"
              label="Other names"
              placeholder="cholecalciferol, D3"
              defaultValue={value('otherNames', row?.otherNames.join(', '))}
              error={fieldError(state, 'otherNames')}
              help="Comma separated. Customers search by these."
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {config.hasParent && (
            <div>
              <label htmlFor={`parentId-${uid}`} className={labelClass}>
                Sits inside
              </label>
              <select
                id={`parentId-${uid}`}
                name="parentId"
                key={`parent-${value('parentId', row?.parentId)}`}
                defaultValue={value('parentId', row?.parentId)}
                className={inputClass}
              >
                <option value="">Top level</option>
                {parents
                  .filter((parent) => parent.id !== row?.id)
                  .map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {config.hasIcon && (
            <Field
              id={`icon-${uid}`}
              name="icon"
              label="Icon"
              placeholder="moon"
              defaultValue={value('icon', row?.icon)}
              error={fieldError(state, 'icon')}
              help="A lucide.dev icon name."
            />
          )}

          {config.hasSortOrder && (
            <Field
              id={`sortOrder-${uid}`}
              name="sortOrder"
              label="Sort order"
              type="number"
              min={0}
              className="max-w-24"
              defaultValue={value('sortOrder', row?.sortOrder ?? 0)}
              error={fieldError(state, 'sortOrder')}
              help="Lower first."
            />
          )}
        </div>

        <label htmlFor={`isActive-${uid}`} className="flex items-center gap-2 text-sm text-ink-900">
          <input
            id={`isActive-${uid}`}
            type="checkbox"
            name="isActive"
            value="true"
            defaultChecked={row?.isActive ?? true}
            className="size-4 rounded-[3px] border border-line-strong"
          />
          Visible on the storefront
        </label>

        <div className="flex items-center gap-2">
          <SubmitButton size="sm" loadingLabel="Saving…">
            {row ? 'Save' : `Create ${config.singular}`}
          </SubmitButton>
          <button
            type="button"
            onClick={onDone}
            className={buttonVariants({ variant: 'link', size: 'sm' })}
          >
            Cancel
          </button>
        </div>
      </form>

      {config.hasLogo && row && logoBaseUrl && (
        <BrandLogo kind={kind} brandId={row.id} logoPath={row.logoPath} baseUrl={logoBaseUrl} />
      )}

      {/*
        Hiding is a separate form from the editor: it is not a field you save, it is an action
        with its own consequence — and for a category with published products or visible children
        it is refused outright rather than quietly applied.
      */}
      {row && (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-line pt-3">
          <form action={toggleAction}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="isActive" value={row.isActive ? '' : 'true'} />
            <SubmitButton size="sm" variant="secondary" loadingLabel="Saving…">
              {row.isActive ? 'Hide from the storefront' : 'Show on the storefront'}
            </SubmitButton>
            <p className="mt-1 max-w-sm text-xs text-ink-500">
              {row.isActive
                ? /*
                   * This used to say "never deleted", which was true when it was written and is not any
                   * more — brands and categories can now be removed when nothing points at them. Hiding
                   * is still the answer while something does, so the sentence keeps that half and drops
                   * the promise it can no longer make.
                   */
                  `Hiding keeps every page working. ${row.usageCount} product${row.usageCount === 1 ? '' : 's'} reference this.`
                : 'Currently hidden from customers.'}
            </p>
          </form>

          {/*
            Removal, for the two kinds that have somewhere to be removed to.

            `health_goals` and `ingredients` have no `deleted_at` column, so there is no such state for
            them — and `removeSchema` says so in the only place that can enforce it. Offering a button
            here that the action must then refuse would be an invitation to a dead end.
          */}
          {(kind === 'brand' || kind === 'category') && (
            <RemoveControl
              action={removeTaxonomy}
              hiddenFields={{ kind, id: row.id }}
              label={row.nameSq || row.slug}
              noun={kind}
              errorCopy={CATALOG_ERRORS}
            />
          )}
        </div>
      )}

      {failure && !failure.ok && (
        <Alert tone="error" className="mt-3">
          {failure.fieldErrors
            ? CATALOG_ERRORS['admin.catalog.errors.checkFields']
            : message(failure.error)}
        </Alert>
      )}
    </div>
  );
}

/** A labelled text input with its error and help text — the shape repeated a dozen times above. */
function Field({
  id,
  name,
  label,
  error,
  help,
  required,
  className,
  ...rest
}: {
  id: string;
  name: string;
  label: string;
  error?: string | null;
  help?: string;
  required?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'name' | 'className'>) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label} {required && <span className="text-error">*</span>}
      </label>
      {/*
        `{...rest}` first, so the props this component is responsible for cannot be overwritten
        by a caller passing the same key. M5 shipped a `SubmitButton` that spread after
        `disabled` and so let `disabled={false}` defeat its own double-submit guard (docs/13 §J3);
        here the equivalent would be a caller silently clearing `aria-invalid` on a bad field.
      */}
      <input
        {...rest}
        id={id}
        name={name}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        className={cn(inputClass, error && 'border-2 border-error', className)}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-error">
          {error}
        </p>
      ) : (
        help && (
          <p id={`${id}-help`} className="mt-1 text-xs text-ink-500">
            {help}
          </p>
        )
      )}
    </div>
  );
}

/** docs/08 §7 — the compliance rule, in view of the person writing the sentence. */
function ClaimsReminder() {
  return (
    <div className="rounded-sm border border-warning bg-warning/10 p-3 text-xs text-ink-900">
      <p className="font-medium">Before you describe what this does</p>
      <p className="mt-1 text-ink-600">{CLAIMS_REMINDER.guidance}</p>
      <p className="mt-1 text-ink-600">
        Avoid: {CLAIMS_REMINDER.banned.join(', ')} — and their Albanian equivalents.
      </p>
    </div>
  );
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/webp', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/avif'];

/**
 * Brand logo upload — the same three-step sequence as the product Media tab: sign, PUT, record.
 *
 * `supabase-js` is imported inside the handler for the reason spelled out in `media-tab.tsx`: at
 * module scope it ships a whole client to every visit for a file picker most never touch.
 */
function BrandLogo({
  kind,
  brandId,
  logoPath,
  baseUrl,
}: {
  kind: TaxonomyKind;
  brandId: string;
  logoPath: string | null;
  baseUrl: string;
}) {
  /* The action keys on table names; the config keys on the singular. One map, at the boundary. */
  const target = kind === 'brand' ? 'brands' : kind === 'category' ? 'categories' : 'health_goals';
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > LOGO_MAX_BYTES) {
      setError(CATALOG_ERRORS['admin.catalog.errors.fileTooLarge']);
      return;
    }
    if (!LOGO_TYPES.includes(file.type)) {
      setError('Logos must be SVG, WebP, JPEG, PNG or AVIF.');
      return;
    }

    setUploading(true);
    try {
      const signForm = new FormData();
      signForm.set('kind', target);
      signForm.set('brandId', brandId);
      signForm.set('contentType', file.type);
      signForm.set('size', String(file.size));

      const signed = await createBrandLogoUploadUrl(null, signForm);
      if (!signed?.ok || !signed.data.path || !signed.data.token) {
        setError(signed && !signed.ok ? message(signed.error) : 'Upload failed.');
        return;
      }

      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: file.type });

      if (uploadError) {
        setError(CATALOG_ERRORS['admin.catalog.errors.uploadFailed']);
        return;
      }

      const attachForm = new FormData();
      attachForm.set('kind', target);
      attachForm.set('brandId', brandId);
      attachForm.set('path', signed.data.path);

      const attached = await attachBrandLogo(null, attachForm);
      if (!attached?.ok) {
        // The bytes are up but the row failed — remove the object rather than leave an orphan.
        await supabase.storage.from('brand-assets').remove([signed.data.path]);
        setError(attached && !attached.ok ? message(attached.error) : 'Upload failed.');
        return;
      }

      window.location.reload();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className={labelClass}>Logo</p>
      <div className="mt-2 flex items-center gap-3">
        {logoPath ? (
          <Image
            src={`${baseUrl}/${logoPath}`}
            alt=""
            width={64}
            height={64}
            unoptimized
            className="size-16 rounded-sm border border-line bg-surface object-contain"
          />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-sm border border-dashed border-line-strong text-xs text-ink-500">
            None
          </div>
        )}

        <label
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'cursor-pointer',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          <Upload className="size-4" aria-hidden="true" />
          {uploading ? 'Uploading…' : logoPath ? 'Replace logo' : 'Upload logo'}
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_TYPES.join(',')}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-ink-500">Square works best. Up to 2 MB.</p>
      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
    </div>
  );
}
