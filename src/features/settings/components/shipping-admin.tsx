'use client';

import { useActionState, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveShippingMethod,
  type SettingsErrorKey,
  type SettingsState,
} from '@/features/settings/actions';
import { SETTINGS_ERRORS } from '@/features/settings/copy';
import type { ShippingMethodRow } from '@/features/settings/queries';
import { formatPrice, fromCents } from '@/lib/money';
import { cn } from '@/lib/utils';

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

function fieldError(state: SettingsState, field: string): string | null {
  if (!state || state.ok) return null;
  return state.fieldErrors?.[field]?.[0] ?? null;
}

function formError(state: SettingsState): string | null {
  if (!state || state.ok) return null;
  if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) return null;
  return SETTINGS_ERRORS[state.error as SettingsErrorKey];
}

/**
 * docs/06 §15 — shipping methods.
 *
 * No delete. Orders store the method they were placed with as a jsonb snapshot, but the row is
 * also referenced by `orders.shipping_method_id` and by every active subscription; removing one
 * would break renewals for whoever chose it. Deactivating takes it out of checkout, which is what
 * "remove" actually means here.
 */
export function ShippingAdmin({ rows }: { rows: ShippingMethodRow[] }) {
  const [editing, setEditing] = useState<ShippingMethodRow | 'new' | null>(null);

  return (
    <div>
      <div className="mb-4">
        {editing === 'new' ? (
          <MethodForm method={null} nextPosition={rows.length} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden="true" />
            New method
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Truck className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">No shipping methods</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Checkout cannot be completed without one. Add the courier you use.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium text-ink-900">
                    {row.nameSq}
                    {!row.isActive && (
                      <span className="ml-2 rounded-sm bg-ink-600 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink-600">
                    <span data-numeric>{formatPrice(row.priceCents, 'sq')}</span>
                    {row.freeOverCents && (
                      <>
                        {' · free over '}
                        <span data-numeric>{formatPrice(row.freeOverCents, 'sq')}</span>
                      </>
                    )}
                    {' · '}
                    <span data-numeric>
                      {row.minDays}–{row.maxDays}
                    </span>{' '}
                    days · {row.countries.join(', ') || 'no countries'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setEditing(editing !== 'new' && editing?.id === row.id ? null : row)
                  }
                >
                  Edit
                </Button>
              </div>

              {editing !== 'new' && editing?.id === row.id && (
                <div className={cn('border-t border-line bg-forest-50/60 p-4')}>
                  <MethodForm
                    method={row}
                    nextPosition={row.position}
                    onDone={() => setEditing(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MethodForm({
  method,
  nextPosition,
  onDone,
}: {
  method: ShippingMethodRow | null;
  nextPosition: number;
  onDone: () => void;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveShippingMethod, null);

  return (
    <ActionForm
      action={action}
      state={state}
      className="rounded-lg border border-line-strong bg-surface p-4"
    >
      {method && <input type="hidden" name="id" value={method.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="nameSq" className={labelClass}>
            Name (Albanian) <span className="text-error">*</span>
          </label>
          <input
            id="nameSq"
            name="nameSq"
            defaultValue={method?.nameSq ?? ''}
            required
            placeholder="Dërgesa standarde"
            className={inputClass}
          />
          {fieldError(state, 'nameSq') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'nameSq')}</p>
          )}
        </div>

        <div>
          <label htmlFor="nameEn" className={labelClass}>
            Name (English)
          </label>
          <input
            id="nameEn"
            name="nameEn"
            defaultValue={method?.nameEn ?? ''}
            placeholder="Standard delivery"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="price" className={labelClass}>
            Price (€) <span className="text-error">*</span>
          </label>
          <input
            id="price"
            name="price"
            defaultValue={method ? fromCents(method.priceCents) : '2.00'}
            required
            className={inputClass}
            data-numeric
          />
          {fieldError(state, 'price') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'price')}</p>
          )}
        </div>

        <div>
          <label htmlFor="freeOver" className={labelClass}>
            Free over (€)
          </label>
          <input
            id="freeOver"
            name="freeOver"
            defaultValue={method?.freeOverCents ? fromCents(method.freeOverCents) : ''}
            placeholder="Never"
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Also drives the &ldquo;spend €X more&rdquo; nudge in the cart.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="minDays" className={labelClass}>
              From (days)
            </label>
            <input
              id="minDays"
              name="minDays"
              type="number"
              min={0}
              defaultValue={method?.minDays ?? 1}
              required
              className={inputClass}
              data-numeric
            />
          </div>
          <div>
            <label htmlFor="maxDays" className={labelClass}>
              To (days)
            </label>
            <input
              id="maxDays"
              name="maxDays"
              type="number"
              min={0}
              defaultValue={method?.maxDays ?? 3}
              required
              className={inputClass}
              data-numeric
            />
            {fieldError(state, 'maxDays') && (
              <p className="mt-1 text-[13px] text-error">{fieldError(state, 'maxDays')}</p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="countries" className={labelClass}>
            Countries <span className="text-error">*</span>
          </label>
          <input
            id="countries"
            name="countries"
            defaultValue={method?.countries.join(', ') ?? 'XK'}
            required
            placeholder="XK, AL"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-ink-500">Two-letter codes, comma separated.</p>
          {fieldError(state, 'countries') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'countries')}</p>
          )}
        </div>

        <div>
          <label htmlFor="position" className={labelClass}>
            Order in the list
          </label>
          <input
            id="position"
            name="position"
            type="number"
            min={0}
            defaultValue={method?.position ?? nextPosition}
            required
            className={inputClass}
            data-numeric
          />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={method?.isActive ?? true}
          className="size-4 rounded-sm border-line-strong"
        />
        Offered at checkout
      </label>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          {method ? 'Save changes' : 'Create method'}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {state?.ok && <span className="text-sm text-success">Saved.</span>}
      </div>

      {formError(state) && (
        <Alert tone="error" className="mt-3">
          {formError(state)}
        </Alert>
      )}
    </ActionForm>
  );
}
