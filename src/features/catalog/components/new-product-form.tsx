'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { CATALOG_ERRORS } from '@/features/catalog/admin-copy';
import { createProduct, type CatalogState } from '@/features/catalog/admin-actions';

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
export function NewProductForm({ brands }: { brands: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<CatalogState, FormData>(createProduct, null);
  const [open, setOpen] = useState(false);

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
            placeholder="now-vitamin-d3-4000"
            className="mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">
            {/* Locked the moment it publishes, so it is worth a moment's thought now. */}
            Lowercase and hyphens. Permanent once published.
          </p>
        </div>

        <div>
          <label htmlFor="new-brand" className="block text-xs font-medium text-ink-900">
            Brand <span className="text-error">*</span>
          </label>
          <select
            id="new-brand"
            name="brandId"
            required
            className="mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm"
          >
            <option value="">Choose…</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="new-name" className="block text-xs font-medium text-ink-900">
            Name (Albanian) <span className="text-error">*</span>
          </label>
          <input
            id="new-name"
            name="nameSq"
            required
            className="mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm"
          />
          <p className="mt-1 text-xs text-ink-500">English is added in the editor.</p>
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
          {CATALOG_ERRORS[state.error]}
        </Alert>
      )}
    </form>
  );
}
