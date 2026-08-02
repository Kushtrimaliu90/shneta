'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { PackagePlus, SlidersHorizontal } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  adjustStock,
  receiveStock,
  setThreshold,
  type InventoryErrorKey,
  type InventoryState,
} from '@/features/inventory/actions';
import {
  INVENTORY_ERRORS,
  STOCK_STATUS_LABELS,
  STOCK_STATUS_TONES,
} from '@/features/inventory/copy';
import type { InventoryRow } from '@/features/inventory/types';
import { cn } from '@/lib/utils';

/**
 * docs/06 §8 — the stock table, with receive and adjust as per-row dialogs.
 *
 * One dialog per row rather than one dialog with a variant picker. The picker version reads
 * better in a spec and is worse in a warehouse: the operator has already found the row they
 * care about, and asking them to find it again in a dropdown of four hundred SKUs is how stock
 * gets received against the wrong variant. The row *is* the selection.
 *
 * Each form opens as an extra row underneath, not as a modal. No focus trap to get wrong, no
 * scroll lock, no page-behind-the-overlay to leave stale — and the row it belongs to stays
 * visible above it, which is what stops an operator typing a count against the wrong SKU.
 */

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

function fieldError(state: InventoryState, field: string): string | null {
  if (!state || state.ok) return null;
  return state.fieldErrors?.[field]?.[0] ?? null;
}

function formError(state: InventoryState): string | null {
  if (!state || state.ok) return null;
  return INVENTORY_ERRORS[state.error as InventoryErrorKey];
}

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
        <PackagePlus className="mx-auto size-6 text-ink-500" aria-hidden="true" />
        <p className="mt-2 font-medium text-carbon-900">Nothing in this view</p>
        <p className="mt-1.5 text-sm text-ink-600">
          Stock rows appear once a product has a variant. Receive stock to give it a count.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
      tabIndex={0}
      role="region"
      aria-label="Stock levels"
    >
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">Stock levels, lowest first</caption>
        <thead>
          <tr className="border-b border-line bg-carbon-50 text-left">
            {['Product', 'SKU', 'Warehouse', 'On hand', 'Low at', 'Status', ''].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
              >
                {heading || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <InventoryRowView key={`${row.variantId}:${row.warehouseId}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryRowView({ row }: { row: InventoryRow }) {
  const [open, setOpen] = useState<'receive' | 'adjust' | 'threshold' | null>(null);
  // Stable so the panels can close themselves from an effect without re-running it every render.
  const close = useCallback(() => setOpen(null), []);

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3">
          <span className="block text-ink-900">{row.productName}</span>
          {row.variantName && <span className="block text-xs text-ink-500">{row.variantName}</span>}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-ink-600">{row.sku}</td>
        <td className="px-4 py-3 text-ink-600">{row.warehouseName}</td>
        <td className="px-4 py-3 text-right text-ink-900" data-numeric>
          {row.onHand}
        </td>
        <td className="px-4 py-3 text-right text-ink-600" data-numeric>
          {row.threshold}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
              STOCK_STATUS_TONES[row.status],
            )}
          >
            {STOCK_STATUS_LABELS[row.status]}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setOpen(open === 'receive' ? null : 'receive')}
              aria-expanded={open === 'receive'}
            >
              Receive
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(open === 'adjust' ? null : 'adjust')}
              aria-expanded={open === 'adjust'}
            >
              Adjust
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(open === 'threshold' ? null : 'threshold')}
              aria-expanded={open === 'threshold'}
              aria-label={`Set low-stock threshold for ${row.sku}`}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line bg-carbon-50/60">
          <td colSpan={7} className="px-4 py-4">
            {open === 'receive' && <ReceiveForm row={row} onDone={close} />}
            {open === 'adjust' && <AdjustForm row={row} onDone={close} />}
            {open === 'threshold' && <ThresholdForm row={row} onDone={close} />}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Closes the panel once the action succeeds.
 *
 * An effect rather than a check during render: calling the parent's setState while rendering a
 * child is the cascading-render bug docs/13 §E2 kept the `react-hooks` v7 fix for, and it would
 * fire on every subsequent render too, not just the one where the result arrived.
 */
function useCloseOnSuccess(state: InventoryState, onDone: () => void): void {
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
}

function ReceiveForm({ row, onDone }: { row: InventoryRow; onDone: () => void }) {
  const [state, action] = useActionState<InventoryState, FormData>(receiveStock, null);

  // The row above has already re-rendered with the new count — that is the confirmation.
  useCloseOnSuccess(state, onDone);

  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="variantId" value={row.variantId} />
      <input type="hidden" name="warehouseId" value={row.warehouseId} />

      <div className="w-24">
        <label htmlFor={`qty-${row.variantId}`} className={labelClass}>
          Quantity
        </label>
        <input
          id={`qty-${row.variantId}`}
          name="quantity"
          type="number"
          min={1}
          defaultValue={1}
          required
          className={inputClass}
          data-numeric
        />
      </div>

      <div className="w-40">
        <label htmlFor={`batch-${row.variantId}`} className={labelClass}>
          Batch number
        </label>
        <input id={`batch-${row.variantId}`} name="batchNumber" className={inputClass} />
      </div>

      <div className="w-40">
        <label htmlFor={`expiry-${row.variantId}`} className={labelClass}>
          Expiry
        </label>
        <input
          id={`expiry-${row.variantId}`}
          name="expiryDate"
          type="date"
          className={inputClass}
        />
      </div>

      <div className="min-w-48 flex-1">
        <label htmlFor={`note-r-${row.variantId}`} className={labelClass}>
          Note
        </label>
        <input
          id={`note-r-${row.variantId}`}
          name="note"
          placeholder="Supplier, delivery reference…"
          className={inputClass}
        />
      </div>

      <div className="flex items-end gap-2 self-stretch pb-0.5">
        <SubmitButton size="sm" loadingLabel="Receiving…">
          Receive
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <FormFeedback state={state} fields={['quantity', 'expiryDate']} />
    </form>
  );
}

function AdjustForm({ row, onDone }: { row: InventoryRow; onDone: () => void }) {
  const [state, action] = useActionState<InventoryState, FormData>(adjustStock, null);

  useCloseOnSuccess(state, onDone);

  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="variantId" value={row.variantId} />
      <input type="hidden" name="warehouseId" value={row.warehouseId} />

      <div className="w-28">
        <label htmlFor={`adj-${row.variantId}`} className={labelClass}>
          Change by
        </label>
        <input
          id={`adj-${row.variantId}`}
          name="quantity"
          type="number"
          placeholder="-2"
          required
          className={inputClass}
          data-numeric
        />
        <p className="mt-1 text-[11px] text-ink-500">
          Now <span data-numeric>{row.onHand}</span>. Use a minus for losses.
        </p>
      </div>

      <div className="min-w-64 flex-1">
        <label htmlFor={`note-a-${row.variantId}`} className={labelClass}>
          Reason <span className="text-error">*</span>
        </label>
        <input
          id={`note-a-${row.variantId}`}
          name="note"
          required
          placeholder="Damaged in transit, stock count correction…"
          className={inputClass}
        />
      </div>

      <div className="flex items-end gap-2 self-stretch pb-0.5">
        <SubmitButton size="sm" variant="secondary" loadingLabel="Adjusting…">
          Adjust
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <FormFeedback state={state} fields={['quantity', 'note']} />
    </form>
  );
}

function ThresholdForm({ row, onDone }: { row: InventoryRow; onDone: () => void }) {
  const [state, action] = useActionState<InventoryState, FormData>(setThreshold, null);

  useCloseOnSuccess(state, onDone);

  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="variantId" value={row.variantId} />
      <input type="hidden" name="warehouseId" value={row.warehouseId} />

      <div className="w-32">
        <label htmlFor={`thr-${row.variantId}`} className={labelClass}>
          Warn at or below
        </label>
        <input
          id={`thr-${row.variantId}`}
          name="threshold"
          type="number"
          min={0}
          defaultValue={row.threshold}
          required
          className={inputClass}
          data-numeric
        />
      </div>

      <p className="max-w-md flex-1 pt-6 text-xs text-ink-600">
        This also changes what customers see: the product page shows &ldquo;low stock&rdquo; at or
        below this number.
      </p>

      <div className="flex items-end gap-2 self-stretch pb-0.5">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>

      <FormFeedback state={state} fields={['threshold']} />
    </form>
  );
}

/** One place that renders whichever of a form's errors actually came back. */
function FormFeedback({ state, fields }: { state: InventoryState; fields: string[] }) {
  const field = fields.map((name) => fieldError(state, name)).find(Boolean);
  const form = formError(state);

  if (!field && !form) return null;

  return (
    <Alert tone="error" className="w-full">
      {field ?? form}
    </Alert>
  );
}
