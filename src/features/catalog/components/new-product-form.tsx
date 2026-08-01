'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { createProduct, type CatalogState } from '@/features/catalog/admin-actions';
import { cn } from '@/lib/utils';

/**
 * docs/06 §3 — creating a product.
 *
 * Three fields, not six tabs. A product cannot exist without a slug, a brand and an Albanian
 * name; everything else has a sensible empty state and belongs in the editor, where it can be
 * saved incrementally. Asking for the full form up front is how an editor loses twenty minutes
 * of typing to a slug collision.
 *
 * The action redirects into the new product's editor on success, so there is no success state
 * to render here — the page simply changes.
 */
/**
 * Turns a Zod issue code into something an operator can act on.
 *
 * The schemas return identifiers (`SLUG_INVALID`) because they are shared with code that has to
 * branch on them. Showing those to a person is not much better than showing nothing — the point
 * of a field error is to say what to change.
 */
const FIELD_MESSAGES: Record<string, string> = {
  SLUG_INVALID: 'Lowercase letters, numbers and hyphens only — for example now-vitamin-d3-4000.',
  SLUG_TOO_SHORT: 'At least three characters.',
  REQUIRED: 'This is required.',
};

function fieldError(state: CatalogState, field: string): string | null {
  if (!state || state.ok) return null;
  const issue = state.fieldErrors?.[field]?.[0];
  if (!issue) return null;
  return FIELD_MESSAGES[issue] ?? issue;
}

export function NewProductForm({ brands }: { brands: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<CatalogState, FormData>(createProduct, null);
  const [open, setOpen] = useState(false);

  // What was submitted, so a rejected form does not send the operator back to a blank slate.
  const values = state && !state.ok ? (state.values ?? {}) : {};
  const errors = {
    slug: fieldError(state, 'slug'),
    brandId: fieldError(state, 'brandId'),
    nameSq: fieldError(state, 'nameSq'),
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonVariants({ size: 'sm' })}
      >
        <Plus className="size-4" aria-hidden="true" />
        New product
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="w-full rounded-lg border border-line-strong bg-surface p-4"
    >
      <h2 className="font-display text-sm font-semibold text-forest-900">New product</h2>
      <p className="mt-1 text-xs text-ink-600">
        Enough to create a draft. Everything else is in the editor.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="new-slug" className="block text-xs font-medium text-ink-900">
            Slug <span className="text-error">*</span>
          </label>
          <input
            id="new-slug"
            name="slug"
            required
            defaultValue={values.slug}
            aria-invalid={Boolean(errors.slug)}
            aria-describedby={errors.slug ? 'new-slug-error' : undefined}
            placeholder="now-vitamin-d3-4000"
            className={cn(
              'mt-1 h-10 w-full rounded-sm border bg-surface px-3 text-sm',
              errors.slug ? 'border-2 border-error' : 'border-line-strong',
            )}
          />
          {errors.slug ? (
            <p id="new-slug-error" className="mt-1 text-xs text-error">
              {errors.slug}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-500">
              {/* Locked the moment it publishes, so it is worth a moment's thought now. */}
              Lowercase and hyphens. Permanent once published.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-brand" className="block text-xs font-medium text-ink-900">
            Brand <span className="text-error">*</span>
          </label>
          <select
            id="new-brand"
            /*
             * `key` forces a remount when the restored value changes.
             *
             * React applies `defaultValue` to a `<select>` on mount only — unlike a text input,
             * whose DOM value simply survives the re-render, a select re-rendered after a failed
             * submit falls back to its first option. So the slug and the name came back and the
             * brand silently did not, which is worse than losing all three: the operator sees a
             * populated form and no reason to re-check the one field that reset.
             */
            key={values.brandId ?? 'empty'}
            name="brandId"
            required
            defaultValue={values.brandId ?? ''}
            aria-invalid={Boolean(errors.brandId)}
            className={cn(
              'mt-1 h-10 w-full rounded-sm border bg-surface px-3 text-sm',
              errors.brandId ? 'border-2 border-error' : 'border-line-strong',
            )}
          >
            <option value="">Choose…</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          {errors.brandId && <p className="mt-1 text-xs text-error">{errors.brandId}</p>}
        </div>

        <div>
          <label htmlFor="new-name" className="block text-xs font-medium text-ink-900">
            Name (Albanian) <span className="text-error">*</span>
          </label>
          <input
            id="new-name"
            name="nameSq"
            required
            defaultValue={values.nameSq}
            aria-invalid={Boolean(errors.nameSq)}
            className={cn(
              'mt-1 h-10 w-full rounded-sm border bg-surface px-3 text-sm',
              errors.nameSq ? 'border-2 border-error' : 'border-line-strong',
            )}
          />
          {errors.nameSq ? (
            <p className="mt-1 text-xs text-error">{errors.nameSq}</p>
          ) : (
            <p className="mt-1 text-xs text-ink-500">English is added in the editor.</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Creating…">
          Create draft
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonVariants({ variant: 'link', size: 'sm' })}
        >
          Cancel
        </button>
      </div>

      {state && !state.ok && (
        <Alert tone="error" className="mt-3">
          {/*
            "Check the fields marked below" is only true when something *is* marked. When the
            failure has no field errors — a taken slug, say, which passes validation and is
            rejected by the database — the summary has to carry the whole message itself,
            otherwise it points at marks that do not exist. That was the original bug.
          */}
          {state.fieldErrors
            ? CATALOG_ERRORS['admin.catalog.errors.checkFields']
            : CATALOG_ERRORS[state.error]}
        </Alert>
      )}
    </form>
  );
}
