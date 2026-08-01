'use client';

import { useActionState, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { fromCents } from '@/lib/money';
import { pickLocale, type LocalizedField } from '@/lib/i18n';
import { CATALOG_ERRORS, DIETARY_TAGS, PRODUCT_FORMS } from '@/features/catalog/admin-copy';
import {
  deactivateVariant,
  saveProductGeneral,
  saveVariant,
  type CatalogState,
} from '@/features/catalog/admin-actions';
import type { AdminProduct, AdminVariant } from '@/features/catalog/admin-queries';
import { cn } from '@/lib/utils';

/**
 * docs/06 §3 — the product editor.
 *
 * **Tabs are local state, but each tab is its own `<form>` posting its own action.** That is
 * the important structural decision: one giant form spanning six tabs would mean an editor
 * loses their variant edits because a field on the SEO tab failed validation, and it would make
 * "save" mean six different things at once. Saving General does not touch variants and cannot
 * fail because of them.
 *
 * The consequence to be honest about: there is no unsaved-changes guard yet. Switching tabs with
 * unsaved edits loses them. docs/06 §16 asks for a dirty-state guard on long editors and it is
 * not here — noted in docs/14 rather than pretended away.
 *
 * Every bilingual field shows `sq` and `en` side by side rather than behind a locale toggle.
 * A toggle hides which locale is missing, and a half-translated catalogue is the normal state
 * of a bilingual shop — the thing an editor most needs to see at a glance.
 */

type Tab = 'general' | 'variants';

export function ProductEditor({
  product,
  brands,
  categories,
  goals,
}: {
  product: AdminProduct;
  brands: { id: string; name: string }[];
  categories: { id: string; name: LocalizedField }[];
  goals: { id: string; name: LocalizedField }[];
}) {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div>
      <div role="tablist" aria-label="Product sections" className="flex gap-1 border-b border-line">
        {(
          [
            ['general', 'General'],
            ['variants', `Variants (${product.variants.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px min-h-10 border-b-2 px-3 text-sm transition-colors',
              tab === key
                ? 'border-forest-800 font-medium text-forest-900'
                : 'border-transparent text-ink-600 hover:text-forest-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'general' ? (
          <GeneralTab product={product} brands={brands} categories={categories} goals={goals} />
        ) : (
          <VariantsTab product={product} />
        )}
      </div>
    </div>
  );
}

function ErrorAlert({ state }: { state: CatalogState }) {
  if (!state || state.ok) return null;
  return (
    <Alert tone="error" className="mt-3">
      {CATALOG_ERRORS[state.error]}
    </Alert>
  );
}

function Saved({ state }: { state: CatalogState }) {
  if (!state?.ok) return null;
  return (
    <p role="status" className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success">
      <Check className="size-4" aria-hidden="true" />
      Saved.
    </p>
  );
}

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const areaClass =
  'mt-1 w-full rounded-sm border border-line-strong bg-surface px-3 py-2 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

/** A bilingual pair. `sq` is required; `en` falls back to it on the storefront (docs/08 §1). */
function Bilingual({
  name,
  label,
  value,
  rows,
}: {
  name: string;
  label: string;
  value: LocalizedField;
  rows?: number;
}) {
  const sq = (value as Record<string, string | undefined>).sq ?? '';
  const en = (value as Record<string, string | undefined>).en ?? '';

  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
        {label}
      </legend>
      <div>
        <label htmlFor={`${name}.sq`} className={labelClass}>
          Albanian <span className="text-error">*</span>
        </label>
        {rows ? (
          <textarea
            id={`${name}.sq`}
            name={`${name}.sq`}
            rows={rows}
            defaultValue={sq}
            className={areaClass}
          />
        ) : (
          <input id={`${name}.sq`} name={`${name}.sq`} defaultValue={sq} className={inputClass} />
        )}
      </div>
      <div>
        <label htmlFor={`${name}.en`} className={labelClass}>
          English
          {!en && (
            // Not an error — the storefront falls back to Albanian. But a bilingual catalogue
            // half-filled is the normal state, and this is what makes the gap countable.
            <span className="ml-1 font-normal text-warning">missing</span>
          )}
        </label>
        {rows ? (
          <textarea
            id={`${name}.en`}
            name={`${name}.en`}
            rows={rows}
            defaultValue={en}
            className={areaClass}
          />
        ) : (
          <input id={`${name}.en`} name={`${name}.en`} defaultValue={en} className={inputClass} />
        )}
      </div>
    </fieldset>
  );
}

function GeneralTab({
  product,
  brands,
  categories,
  goals,
}: {
  product: AdminProduct;
  brands: { id: string; name: string }[];
  categories: { id: string; name: LocalizedField }[];
  goals: { id: string; name: LocalizedField }[];
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveProductGeneral, null);
  const locked = product.publishedAt !== null;

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-6">
      <input type="hidden" name="productId" value={product.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="slug" className={labelClass}>
            Slug{' '}
            {locked && <span className="font-normal text-ink-500">— locked after publish</span>}
          </label>
          <input
            id="slug"
            name="slug"
            defaultValue={product.slug}
            readOnly={locked}
            /*
             * `readOnly`, not `disabled`: a disabled input is not submitted, and the action
             * requires the slug. Read-only keeps it in the payload where the database's own
             * guard can compare it and confirm nothing changed.
             */
            className={cn(inputClass, locked && 'bg-cream text-ink-500')}
          />
        </div>
        <div>
          <label htmlFor="brandId" className={labelClass}>
            Brand <span className="text-error">*</span>
          </label>
          <select id="brandId" name="brandId" defaultValue={product.brandId} className={inputClass}>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Bilingual name="name" label="Name" value={product.name} />
      <Bilingual name="subtitle" label="Subtitle" value={product.subtitle} />
      <Bilingual name="description" label="Description" value={product.description} rows={5} />
      <Bilingual name="howToUse" label="How to use" value={product.howToUse} rows={3} />
      <Bilingual name="warnings" label="Warnings" value={product.warnings} rows={3} />

      {/* docs/08 §7 — the claim-language reminder, next to the fields that carry claims. */}
      <Alert tone="info" title="Before you publish a claim">
        Only permissible-function wording: &ldquo;contributes to&rdquo;, &ldquo;supports&rdquo;,
        &ldquo;helps maintain&rdquo;. Never <strong>cures</strong>, <strong>treats</strong> or{' '}
        <strong>prevents disease</strong> — those are medicinal claims and are not lawful for a food
        supplement. Warnings for melatonin, iron and anything contraindicated in pregnancy are not
        optional (docs/08 §7).
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="form" className={labelClass}>
            Form
          </label>
          <select id="form" name="form" defaultValue={product.form ?? ''} className={inputClass}>
            <option value="">—</option>
            {PRODUCT_FORMS.map((form) => (
              <option key={form} value={form}>
                {form}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="servingSize" className={labelClass}>
            Serving size
          </label>
          <input
            id="servingSize"
            name="servingSize"
            defaultValue={product.servingSize ?? ''}
            placeholder="2 capsules daily"
            className={inputClass}
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
          Dietary tags
        </legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {DIETARY_TAGS.map((tag) => (
            <label key={tag} htmlFor={`tag-${tag}`} className="flex items-center gap-1.5 text-sm">
              <input
                id={`tag-${tag}`}
                type="checkbox"
                name="dietaryTags"
                value={tag}
                defaultChecked={product.dietaryTags.includes(tag)}
                className="size-4 rounded-[3px] border border-line-strong"
              />
              {tag.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
          Categories
        </legend>
        <p className="mt-1 text-xs text-ink-600">
          One must be primary — it decides the breadcrumb and the canonical URL, and publishing is
          blocked without it.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-3 text-sm">
              <label htmlFor={`cat-${category.id}`} className="flex flex-1 items-center gap-1.5">
                <input
                  id={`cat-${category.id}`}
                  type="checkbox"
                  name="categoryIds"
                  value={category.id}
                  defaultChecked={product.categoryIds.includes(category.id)}
                  className="size-4 rounded-[3px] border border-line-strong"
                />
                {pickLocale(category.name, 'en')}
              </label>
              <label
                htmlFor={`pri-${category.id}`}
                className="flex items-center gap-1 text-xs text-ink-600"
              >
                <input
                  id={`pri-${category.id}`}
                  type="radio"
                  name="primaryCategoryId"
                  value={category.id}
                  defaultChecked={product.primaryCategoryId === category.id}
                  className="size-3.5"
                />
                primary
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
          Health goals
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {goals.map((goal) => (
            <label
              key={goal.id}
              htmlFor={`goal-${goal.id}`}
              className="flex items-center gap-1.5 text-sm"
            >
              <input
                id={`goal-${goal.id}`}
                type="checkbox"
                name="goalIds"
                value={goal.id}
                defaultChecked={product.goalIds.includes(goal.id)}
                className="size-4 rounded-[3px] border border-line-strong"
              />
              {pickLocale(goal.name, 'en')}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="isFeatured" className="flex items-center gap-2 text-sm">
        <input
          id="isFeatured"
          type="checkbox"
          name="isFeatured"
          value="true"
          defaultChecked={product.isFeatured}
          className="size-4 rounded-[3px] border border-line-strong"
        />
        Feature on the home page
      </label>

      <div>
        <SubmitButton loadingLabel="Saving…">Save general</SubmitButton>
        <Saved state={state} />
        <ErrorAlert state={state} />
      </div>
    </form>
  );
}

function VariantsTab({ product }: { product: AdminProduct }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="max-w-3xl">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Variants of this product</caption>
          <thead>
            <tr className="border-b border-line bg-forest-50 text-left">
              {['SKU', 'Name', 'Price', 'State', ''].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-3 py-2 font-ui text-xs font-semibold text-ink-600 uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.variants.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-ink-600">
                  No variants yet. A product needs at least one active variant to be published.
                </td>
              </tr>
            )}
            {product.variants.map((variant) => (
              <tr key={variant.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2" data-numeric>
                  {variant.sku}
                </td>
                <td className="px-3 py-2">{pickLocale(variant.name, 'en') || '—'}</td>
                <td className="px-3 py-2" data-numeric>
                  €{fromCents(variant.priceCents)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {variant.isActive ? (
                    <span className="text-success">Active</span>
                  ) : (
                    <span className="text-ink-500">Inactive</span>
                  )}
                  {variant.isDefault && <span className="ml-1 text-forest-800">· default</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(editing === variant.id ? null : variant.id)}
                    className={buttonVariants({ variant: 'link', size: 'sm' })}
                  >
                    {editing === variant.id ? 'Close' : 'Edit'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {product.variants.map(
        (variant) =>
          editing === variant.id && (
            <div key={variant.id} className="mt-4">
              <VariantForm
                productId={product.id}
                variant={variant}
                onDone={() => setEditing(null)}
              />
            </div>
          ),
      )}

      {adding ? (
        <div className="mt-4">
          <VariantForm productId={product.id} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-4')}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a variant
        </button>
      )}
    </div>
  );
}

function VariantForm({
  productId,
  variant,
  onDone,
}: {
  productId: string;
  variant?: AdminVariant;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveVariant, null);
  const [deactivateState, deactivateAction] = useActionState<CatalogState, FormData>(
    deactivateVariant,
    null,
  );

  return (
    <div className="rounded-lg border border-line-strong bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-forest-900">
          {variant ? `Edit ${variant.sku}` : 'New variant'}
        </h3>
        <button type="button" onClick={onDone} aria-label="Close" className="text-ink-500">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="productId" value={productId} />
        {variant && <input type="hidden" name="variantId" value={variant.id} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`sku-${variant?.id ?? 'new'}`} className={labelClass}>
              SKU <span className="text-error">*</span>
            </label>
            <input
              id={`sku-${variant?.id ?? 'new'}`}
              name="sku"
              defaultValue={variant?.sku}
              placeholder="NOW-D3-120"
              className={inputClass}
              data-numeric
            />
            <p className="mt-1 text-xs text-ink-500">Capitals, digits and hyphens.</p>
          </div>
          <div>
            <label htmlFor={`price-${variant?.id ?? 'new'}`} className={labelClass}>
              Price (EUR) <span className="text-error">*</span>
            </label>
            <input
              id={`price-${variant?.id ?? 'new'}`}
              name="price"
              inputMode="decimal"
              defaultValue={variant ? fromCents(variant.priceCents) : ''}
              placeholder="9.90"
              className={inputClass}
              data-numeric
            />
            {/* docs/07 §5 — VAT-inclusive, and saying so here avoids a whole class of mispricing. */}
            <p className="mt-1 text-xs text-ink-500">Includes VAT.</p>
          </div>
        </div>

        <Bilingual name="name" label="Variant name" value={variant?.name ?? { sq: '' }} />

        <div>
          <label htmlFor={`compare-${variant?.id ?? 'new'}`} className={labelClass}>
            Compare-at price (EUR)
          </label>
          <input
            id={`compare-${variant?.id ?? 'new'}`}
            name="compareAtPrice"
            inputMode="decimal"
            defaultValue={
              variant?.compareAtPriceCents ? fromCents(variant.compareAtPriceCents) : ''
            }
            className={cn(inputClass, 'max-w-40')}
            data-numeric
          />
          <p className="mt-1 text-xs text-ink-500">
            Higher than the price; shows a struck-through &ldquo;was&rdquo; and a discount badge.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <label
            htmlFor={`active-${variant?.id ?? 'new'}`}
            className="flex items-center gap-1.5 text-sm"
          >
            <input
              id={`active-${variant?.id ?? 'new'}`}
              type="checkbox"
              name="isActive"
              value="true"
              defaultChecked={variant?.isActive ?? true}
              className="size-4 rounded-[3px] border border-line-strong"
            />
            Active
          </label>
          <label
            htmlFor={`default-${variant?.id ?? 'new'}`}
            className="flex items-center gap-1.5 text-sm"
          >
            <input
              id={`default-${variant?.id ?? 'new'}`}
              type="checkbox"
              name="isDefault"
              value="true"
              defaultChecked={variant?.isDefault ?? false}
              className="size-4 rounded-[3px] border border-line-strong"
            />
            Default — the one shown first on the product page
          </label>
        </div>

        <div>
          <SubmitButton size="sm" loadingLabel="Saving…">
            {variant ? 'Save variant' : 'Create variant'}
          </SubmitButton>
          <Saved state={state} />
          <ErrorAlert state={state} />
        </div>
      </form>

      {variant?.isActive && (
        <form action={deactivateAction} className="mt-4 border-t border-line pt-3">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variant.id} />
          <SubmitButton size="sm" variant="secondary" loadingLabel="Deactivating…">
            Deactivate
          </SubmitButton>
          <p className="mt-1 text-xs text-ink-500">
            {/* Never deleted: order_items.variant_id is `on delete set null`, so a hard delete
                would sever past orders from what was sold. */}
            Removes it from the shop. Past orders keep their link to it.
          </p>
          <ErrorAlert state={deactivateState} />
        </form>
      )}
    </div>
  );
}
