'use client';

import { useActionState, useState } from 'react';
import { Lock, Plus, Ticket } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveCoupon,
  toggleCoupon,
  type CouponErrorKey,
  type CouponState,
} from '@/features/coupons/actions';
import type { CouponRow, DiscountType } from '@/features/coupons/queries';
import { formatPrice, fromCents } from '@/lib/money';
import { cn } from '@/lib/utils';

const COUPON_ERRORS: Record<CouponErrorKey, string> = {
  'admin.errors.forbidden': 'Only an admin can create or change coupons.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.coupons.errors.checkFields': 'Check the fields marked below.',
  'admin.coupons.errors.codeTaken': 'That code already exists.',
  'admin.coupons.errors.systemLocked':
    'This is a system coupon — subscriptions and the points exchange depend on it. It cannot be edited here.',
  'admin.coupons.errors.notFound': 'That coupon no longer exists.',
};

const TYPE_LABELS: Record<DiscountType, string> = {
  percentage: 'Percentage off',
  fixed: 'Amount off',
  free_shipping: 'Free shipping',
};

const inputClass =
  'mt-1 h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900';
const labelClass = 'block text-xs font-medium text-ink-900';

function fieldError(state: CouponState, field: string): string | null {
  if (!state || state.ok) return null;
  return state.fieldErrors?.[field]?.[0] ?? null;
}

function formError(state: CouponState): string | null {
  if (!state || state.ok) return null;
  if (state.fieldErrors && Object.keys(state.fieldErrors).length > 0) return null;
  return COUPON_ERRORS[state.error as CouponErrorKey];
}

/** How a coupon's discount reads in one line. */
function describe(row: CouponRow): string {
  if (row.type === 'free_shipping') return 'Free shipping';
  if (row.type === 'percentage') return `${row.value}% off`;
  return `${formatPrice(row.value, 'sq')} off`;
}

export function CouponsAdmin({ rows, canManage }: { rows: CouponRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<CouponRow | 'new' | null>(null);

  return (
    <div>
      {canManage && (
        <div className="mt-6">
          {editing === 'new' ? (
            <CouponForm coupon={null} onDone={() => setEditing(null)} />
          ) : (
            <Button type="button" size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden="true" />
              New coupon
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Ticket className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">No coupons yet</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Create one and it becomes claimable on the offers page — unless you leave it inactive.
          </p>
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface"
          tabIndex={0}
          role="region"
          aria-label="Coupons"
        >
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">Coupons</caption>
            <thead>
              <tr className="border-b border-line bg-forest-50 text-left">
                {['Code', 'Discount', 'Conditions', 'Window', 'Used', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                  >
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CouponRowView
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  isEditing={editing !== 'new' && editing?.id === row.id}
                  onEdit={() => setEditing(row)}
                  onDone={() => setEditing(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CouponRowView({
  row,
  canManage,
  isEditing,
  onEdit,
  onDone,
}: {
  row: CouponRow;
  canManage: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [toggleState, toggleAction] = useActionState<CouponState, FormData>(toggleCoupon, null);
  const exhausted = row.maxUses !== null && row.redemptionCount >= row.maxUses;

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-3">
          <span className="font-mono text-sm font-medium text-ink-900">{row.code}</span>
          {row.isSystem && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded-sm bg-ink-600 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white"
              title="Used by subscriptions or the points exchange"
            >
              <Lock className="size-3" aria-hidden="true" />
              System
            </span>
          )}
          {row.note && <span className="block text-xs text-ink-500">{row.note}</span>}
        </td>
        <td className="px-4 py-3 text-ink-900">{describe(row)}</td>
        <td className="px-4 py-3 text-xs text-ink-600">
          {row.minSubtotalCents ? (
            <span data-numeric>Min {formatPrice(row.minSubtotalCents, 'sq')}</span>
          ) : (
            '—'
          )}
          {row.maxUsesPerUser && (
            <span className="block" data-numeric>
              {row.maxUsesPerUser} per customer
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-ink-600" data-numeric>
          {row.startsAt || row.endsAt
            ? `${row.startsAt?.slice(0, 10) ?? '…'} → ${row.endsAt?.slice(0, 10) ?? '…'}`
            : 'Always'}
        </td>
        <td className="px-4 py-3 text-right text-ink-600" data-numeric>
          {row.redemptionCount}
          {row.maxUses !== null && ` / ${row.maxUses}`}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
              !row.isActive
                ? 'bg-ink-600 text-white'
                : exhausted
                  ? 'bg-warning text-white'
                  : 'bg-success text-white',
            )}
          >
            {!row.isActive ? 'Inactive' : exhausted ? 'Used up' : 'Active'}
          </span>
        </td>
        <td className="px-4 py-3">
          {canManage && !row.isSystem && (
            <div className="flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
              <form action={toggleAction}>
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="isActive" value={String(!row.isActive)} />
                <SubmitButton size="sm" variant="secondary" loadingLabel="…">
                  {row.isActive ? 'Deactivate' : 'Activate'}
                </SubmitButton>
              </form>
            </div>
          )}
        </td>
      </tr>

      {formError(toggleState) && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <Alert tone="error">{formError(toggleState)}</Alert>
          </td>
        </tr>
      )}

      {isEditing && (
        <tr className="border-b border-line bg-forest-50/60">
          <td colSpan={7} className="px-4 py-4">
            <CouponForm coupon={row} onDone={onDone} />
          </td>
        </tr>
      )}
    </>
  );
}

function CouponForm({ coupon, onDone }: { coupon: CouponRow | null; onDone: () => void }) {
  const [state, action] = useActionState<CouponState, FormData>(saveCoupon, null);
  const [type, setType] = useState<DiscountType>(coupon?.type ?? 'percentage');

  return (
    <form action={action} className="rounded-lg border border-line-strong bg-surface p-4">
      {coupon && <input type="hidden" name="id" value={coupon.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="code" className={labelClass}>
            Code <span className="text-error">*</span>
          </label>
          <input
            id="code"
            name="code"
            defaultValue={coupon?.code ?? ''}
            required
            placeholder="VERA25"
            className={cn(inputClass, 'font-mono uppercase')}
          />
          {fieldError(state, 'code') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'code')}</p>
          )}
        </div>

        <div>
          <label htmlFor="type" className={labelClass}>
            Discount type
          </label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(event) => setType(event.currentTarget.value as DiscountType)}
            className={inputClass}
          >
            {(Object.keys(TYPE_LABELS) as DiscountType[]).map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="value" className={labelClass}>
            {type === 'percentage' ? 'Percent off' : type === 'fixed' ? 'Amount off (€)' : 'Value'}
          </label>
          <input
            id="value"
            name="value"
            defaultValue={
              coupon
                ? coupon.type === 'fixed'
                  ? fromCents(coupon.value)
                  : String(coupon.value)
                : ''
            }
            disabled={type === 'free_shipping'}
            placeholder={type === 'percentage' ? '15' : '5.00'}
            className={inputClass}
            data-numeric
          />
          {type === 'free_shipping' && (
            <p className="mt-1 text-[11px] text-ink-500">Not needed — shipping becomes free.</p>
          )}
          {fieldError(state, 'value') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'value')}</p>
          )}
        </div>

        <div>
          <label htmlFor="minSubtotal" className={labelClass}>
            Minimum basket (€)
          </label>
          <input
            id="minSubtotal"
            name="minSubtotal"
            defaultValue={coupon?.minSubtotalCents ? fromCents(coupon.minSubtotalCents) : ''}
            placeholder="20.00"
            className={inputClass}
            data-numeric
          />
        </div>

        <div>
          <label htmlFor="maxUses" className={labelClass}>
            Total uses
          </label>
          <input
            id="maxUses"
            name="maxUses"
            type="number"
            min={1}
            defaultValue={coupon?.maxUses ?? ''}
            placeholder="Unlimited"
            className={inputClass}
            data-numeric
          />
        </div>

        <div>
          <label htmlFor="maxUsesPerUser" className={labelClass}>
            Uses per customer
          </label>
          <input
            id="maxUsesPerUser"
            name="maxUsesPerUser"
            type="number"
            min={1}
            defaultValue={coupon?.maxUsesPerUser ?? ''}
            placeholder="Unlimited"
            className={inputClass}
            data-numeric
          />
        </div>

        <div>
          <label htmlFor="startsAt" className={labelClass}>
            Starts
          </label>
          <input
            id="startsAt"
            name="startsAt"
            type="date"
            defaultValue={coupon?.startsAt?.slice(0, 10) ?? ''}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="endsAt" className={labelClass}>
            Ends
          </label>
          <input
            id="endsAt"
            name="endsAt"
            type="date"
            defaultValue={coupon?.endsAt?.slice(0, 10) ?? ''}
            className={inputClass}
          />
          {fieldError(state, 'endsAt') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'endsAt')}</p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="note" className={labelClass}>
            Internal note
          </label>
          <input
            id="note"
            name="note"
            defaultValue={coupon?.note ?? ''}
            placeholder="Summer campaign, Instagram"
            className={inputClass}
          />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={coupon?.isActive ?? true}
          className="size-4 rounded-sm border-line-strong"
        />
        Active — customers can use it, and it appears on the offers page
      </label>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          {coupon ? 'Save changes' : 'Create coupon'}
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
    </form>
  );
}
