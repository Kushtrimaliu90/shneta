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
  saveProductSeo,
  saveVariant,
  type CatalogState,
} from '@/features/catalog/admin-actions';
import {
  saveProductCertifications,
  saveProductIngredients,
} from '@/features/catalog/label-actions';
import { formatAdminDateTime } from '@/features/admin/copy';
import { MediaTab } from '@/features/catalog/components/media-tab';
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

type Tab = 'general' | 'variants' | 'label' | 'media' | 'seo' | 'compliance';

export function ProductEditor({
  product,
  brands,
  categories,
  goals,
  ingredients,
  certifications,
  imageBaseUrl,
}: {
  product: AdminProduct;
  brands: { id: string; name: string }[];
  categories: { id: string; name: LocalizedField }[];
  goals: { id: string; name: LocalizedField }[];
  ingredients: { id: string; name: LocalizedField; slug: string }[];
  certifications: { id: string; name: LocalizedField }[];
  imageBaseUrl: string;
}) {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div>
      <div
        role="tablist"
        aria-label="Product sections"
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {(
          [
            ['general', 'General'],
            ['variants', `Variants (${product.variants.length})`],
            ['label', `Ingredients (${product.label.length})`],
            ['media', `Media (${product.images.length})`],
            ['seo', 'SEO'],
            ['compliance', 'Compliance'],
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
        {tab === 'general' && (
          <GeneralTab product={product} brands={brands} categories={categories} goals={goals} />
        )}
        {tab === 'variants' && <VariantsTab product={product} />}
        {tab === 'label' && <LabelTab product={product} ingredients={ingredients} />}
        {tab === 'media' && (
          <MediaTab productId={product.id} images={product.images} publicBaseUrl={imageBaseUrl} />
        )}
        {tab === 'seo' && <SeoTab product={product} />}
        {tab === 'compliance' && (
          <ComplianceTab product={product} certifications={certifications} />
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

/**
 * docs/06 §3.3 — the supplement facts label.
 *
 * The one tab that is genuinely client-stateful. Rows can be added and removed before anything
 * is saved, and the whole list posts as one JSON field — see `label-actions.ts` for why five
 * parallel FormData arrays would not survive an unchecked checkbox.
 *
 * The %NRV column is why this matters beyond data entry: it is what a customer compares between
 * two products, and until now it was only enterable by hand-writing SQL.
 */
function LabelTab({
  product,
  ingredients,
}: {
  product: AdminProduct;
  ingredients: { id: string; name: LocalizedField; slug: string }[];
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveProductIngredients, null);
  const [rows, setRows] = useState(() =>
    product.label.map((row) => ({
      ingredientId: row.ingredientId,
      amount: row.amount == null ? '' : String(row.amount),
      unit: row.unit ?? '',
      nrvPct: row.nrvPct == null ? '' : String(row.nrvPct),
      perServing: row.perServing,
    })),
  );

  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const nameOf = (id: string) => {
    const match = ingredients.find((ingredient) => ingredient.id === id);
    return match ? pickLocale(match.name, 'en') || match.slug : id;
  };

  // Only ingredients not already on the label: the composite primary key rejects a repeat, and
  // offering one is inviting the error rather than preventing it.
  const available = ingredients.filter(
    (ingredient) => !rows.some((row) => row.ingredientId === ingredient.id),
  );

  return (
    <form action={formAction} className="max-w-3xl">
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />

      <p className="text-sm text-ink-600">
        What one serving contains. Shown on the product page as the ingredient table, in this order.
      </p>

      {ingredients.length === 0 && (
        <Alert tone="info" className="mt-3">
          There are no ingredients to choose from yet. Add them under Ingredients first.
        </Alert>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Ingredients in one serving</caption>
          <thead>
            <tr className="border-b border-line bg-forest-50 text-left">
              {['Ingredient', 'Amount', 'Unit', '% NRV', 'Per serving'].map((heading) => (
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
                <td colSpan={6} className="px-3 py-4 text-ink-600">
                  Nothing on the label yet.
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <tr key={row.ingredientId} className="border-b border-line last:border-0">
                <td className="px-3 py-2 text-ink-900">{nameOf(row.ingredientId)}</td>
                <td className="px-3 py-2">
                  <label htmlFor={`amount-${row.ingredientId}`} className="sr-only">
                    Amount of {nameOf(row.ingredientId)}
                  </label>
                  <input
                    id={`amount-${row.ingredientId}`}
                    value={row.amount}
                    inputMode="decimal"
                    onChange={(event) => update(index, { amount: event.target.value })}
                    className={cn(inputClass, 'mt-0 h-9 w-24')}
                    data-numeric
                  />
                </td>
                <td className="px-3 py-2">
                  <label htmlFor={`unit-${row.ingredientId}`} className="sr-only">
                    Unit for {nameOf(row.ingredientId)}
                  </label>
                  <input
                    id={`unit-${row.ingredientId}`}
                    value={row.unit}
                    placeholder="mg"
                    onChange={(event) => update(index, { unit: event.target.value })}
                    className={cn(inputClass, 'mt-0 h-9 w-20')}
                  />
                </td>
                <td className="px-3 py-2">
                  <label htmlFor={`nrv-${row.ingredientId}`} className="sr-only">
                    Percent NRV for {nameOf(row.ingredientId)}
                  </label>
                  <input
                    id={`nrv-${row.ingredientId}`}
                    value={row.nrvPct}
                    inputMode="decimal"
                    onChange={(event) => update(index, { nrvPct: event.target.value })}
                    className={cn(inputClass, 'mt-0 h-9 w-20')}
                    data-numeric
                  />
                </td>
                <td className="px-3 py-2">
                  <label
                    htmlFor={`per-${row.ingredientId}`}
                    className="flex items-center gap-1.5 text-xs text-ink-600"
                  >
                    <input
                      id={`per-${row.ingredientId}`}
                      type="checkbox"
                      checked={row.perServing}
                      onChange={(event) => update(index, { perServing: event.target.checked })}
                      className="size-4 rounded-[3px] border border-line-strong"
                    />
                    per serving
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    className={buttonVariants({ variant: 'link', size: 'sm' })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {available.length > 0 && (
        <div className="mt-3">
          <label htmlFor="add-ingredient" className={labelClass}>
            Add an ingredient
          </label>
          <select
            id="add-ingredient"
            value=""
            onChange={(event) => {
              const ingredientId = event.target.value;
              if (!ingredientId) return;
              setRows((current) => [
                ...current,
                { ingredientId, amount: '', unit: '', nrvPct: '', perServing: true },
              ]);
            }}
            className={cn(inputClass, 'w-64')}
          >
            <option value="">Choose…</option>
            {available.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {pickLocale(ingredient.name, 'en') || ingredient.slug}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5">
        <SubmitButton loadingLabel="Saving…">Save label</SubmitButton>
        <Saved state={state} />
        <ErrorAlert state={state} />
      </div>
    </form>
  );
}

/**
 * docs/06 §3.5 — search engine overrides.
 *
 * Blank means "use the product's own name and subtitle", which is what the PDP does. The
 * character counters are advisory: a search engine truncates rather than rejects, so a hard limit
 * would be inventing a rule, while no feedback at all leaves an editor guessing.
 */
function SeoTab({ product }: { product: AdminProduct }) {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveProductSeo, null);

  const [values, setValues] = useState({
    titleSq: (product.seoTitle as Record<string, string | undefined> | null)?.sq ?? '',
    titleEn: (product.seoTitle as Record<string, string | undefined> | null)?.en ?? '',
    descriptionSq: (product.seoDescription as Record<string, string | undefined> | null)?.sq ?? '',
    descriptionEn: (product.seoDescription as Record<string, string | undefined> | null)?.en ?? '',
  });

  const set = (patch: Partial<typeof values>) => setValues((current) => ({ ...current, ...patch }));

  const derivedTitle = pickLocale(product.name, 'sq');
  const derivedDescription = pickLocale(product.subtitle, 'sq');

  return (
    <form action={formAction} className="flex max-w-3xl flex-col gap-5">
      <input type="hidden" name="productId" value={product.id} />

      <p className="text-sm text-ink-600">
        Leave a field empty and the page uses the product&rsquo;s own name and subtitle. Fill these
        in only when the catalogue wording is not what you want in a search result.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <CountedField
          id="seo-title-sq"
          name="titleSq"
          label="Title (Albanian)"
          limit={60}
          value={values.titleSq}
          onChange={(next) => set({ titleSq: next })}
          placeholder={derivedTitle}
        />
        <CountedField
          id="seo-title-en"
          name="titleEn"
          label="Title (English)"
          limit={60}
          value={values.titleEn}
          onChange={(next) => set({ titleEn: next })}
          placeholder={derivedTitle}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <CountedField
          id="seo-desc-sq"
          name="descriptionSq"
          label="Description (Albanian)"
          limit={155}
          rows={3}
          value={values.descriptionSq}
          onChange={(next) => set({ descriptionSq: next })}
          placeholder={derivedDescription}
        />
        <CountedField
          id="seo-desc-en"
          name="descriptionEn"
          label="Description (English)"
          limit={155}
          rows={3}
          value={values.descriptionEn}
          onChange={(next) => set({ descriptionEn: next })}
          placeholder={derivedDescription}
        />
      </div>

      {/* Roughly what a search result looks like — enough to judge truncation, not a mock-up. */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-xs font-semibold tracking-wide text-ink-600 uppercase">Preview</p>
        <p className="mt-2 text-sm text-ink-500">shtrejt.com › product › {product.slug}</p>
        <p className="truncate text-base text-forest-800 underline underline-offset-2">
          {values.titleSq || derivedTitle || product.slug}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">
          {values.descriptionSq || derivedDescription || '—'}
        </p>
      </div>

      <div>
        <SubmitButton loadingLabel="Saving…">Save SEO</SubmitButton>
        <Saved state={state} />
        <ErrorAlert state={state} />
      </div>
    </form>
  );
}

/** A text field with a live character count, amber once it is past the useful length. */
function CountedField({
  id,
  name,
  label,
  limit,
  value,
  onChange,
  placeholder,
  rows,
}: {
  id: string;
  name: string;
  label: string;
  limit: number;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  const over = value.length > limit;

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {rows ? (
        <textarea
          id={id}
          name={name}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={areaClass}
        />
      ) : (
        <input
          id={id}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )}
      <p className={cn('mt-1 text-xs', over ? 'text-warning' : 'text-ink-500')}>
        <span data-numeric>{value.length}</span> / {limit}
        {over && ' — likely to be cut short in results'}
      </p>
    </div>
  );
}

/**
 * docs/06 §3.6 — certifications and the approval record.
 *
 * The approve and reject controls are in the page header (`ProductStatusControl`), where they
 * belong: approving is a status transition, not a field. What lives here is the evidence a
 * reviewer needs and the record of what was signed off.
 *
 * **Lab reports are not here.** The `lab-reports` bucket and table exist, private, but nothing on
 * the storefront renders a certificate of analysis yet — an uploader for a document no customer
 * can reach is a feature with no observable effect. It belongs with the PDP section that displays
 * it (docs/05 §3), and is listed in docs/14 rather than half-built here.
 */
function ComplianceTab({
  product,
  certifications,
}: {
  product: AdminProduct;
  certifications: { id: string; name: LocalizedField }[];
}) {
  const [state, formAction] = useActionState<CatalogState, FormData>(
    saveProductCertifications,
    null,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="font-display text-sm font-semibold text-forest-900">Approval</h3>
        {product.approvedBy ? (
          <p className="mt-1.5 text-sm text-ink-600">
            Approved
            {product.approvedAt && (
              <>
                {' '}
                <time dateTime={product.approvedAt} data-numeric>
                  {formatAdminDateTime(product.approvedAt).display}
                </time>
              </>
            )}
            .
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-ink-600">
            Not yet approved. A product cannot be published until someone in compliance has cleared
            its claims — the control is in the header above.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-500">
          {/* The reviewer's identity lives in `audit_logs`, which only admins read. Naming the
              limitation beats showing a UUID and calling it a name. */}
          The full history, including who approved and any rejection note, is in the audit log.
        </p>
      </div>

      <form action={formAction}>
        <input type="hidden" name="productId" value={product.id} />
        <fieldset>
          <legend className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
            Certifications
          </legend>
          <p className="mt-1 text-xs text-ink-600">
            Only what the supplier can evidence. These render as badges on the product page, and a
            badge is a claim like any other.
          </p>
          {certifications.length === 0 ? (
            <p className="mt-2 text-sm text-ink-600">No certifications are set up yet.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {certifications.map((certification) => (
                <label
                  key={certification.id}
                  htmlFor={`cert-${certification.id}`}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <input
                    id={`cert-${certification.id}`}
                    type="checkbox"
                    name="certificationIds"
                    value={certification.id}
                    defaultChecked={product.certificationIds.includes(certification.id)}
                    className="size-4 rounded-[3px] border border-line-strong"
                  />
                  {pickLocale(certification.name, 'en')}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="mt-4">
          <SubmitButton loadingLabel="Saving…">Save certifications</SubmitButton>
          <Saved state={state} />
          <ErrorAlert state={state} />
        </div>
      </form>
    </div>
  );
}
