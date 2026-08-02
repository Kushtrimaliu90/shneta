'use client';

import { useTranslations } from 'next-intl';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { removeCartLineForm, updateCartQuantityForm } from '@/features/cart/actions';
import { notifyCartChanged } from '@/features/cart/cart-events';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — 44px touch targets.
 *
 * Three separate one-field forms rather than one form with JavaScript branching: each button
 * is independently submittable, so the whole control works with JavaScript disabled, and
 * `useFormStatus` disables only the button being pressed.
 *
 * The actions are wrapped rather than passed straight through, so the navbar badge hears about
 * the change (docs/13 §M1). Wrapping keeps the no-JavaScript path intact: without it the form
 * still posts to the server action, and the badge is then correct on the next full render anyway.
 */
async function updateQuantity(formData: FormData): Promise<void> {
  await updateCartQuantityForm(formData);
  notifyCartChanged();
}

async function removeLine(formData: FormData): Promise<void> {
  await removeCartLineForm(formData);
  notifyCartChanged();
}
function IconSubmit({
  label,
  children,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      aria-label={label}
      disabled={pending || disabled}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-sm text-ink-900 transition-colors',
        'hover:bg-carbon-50 disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

export function QuantityStepper({
  lineId,
  quantity,
  maxQuantity,
}: {
  lineId: string;
  quantity: number;
  maxQuantity: number;
}) {
  const t = useTranslations('cart');

  return (
    <div className="flex items-center gap-1">
      <form action={updateQuantity}>
        <input type="hidden" name="lineId" value={lineId} />
        <input type="hidden" name="quantity" value={quantity - 1} />
        {/* At one, decrementing removes the line — the action treats 0 as remove. */}
        <IconSubmit label={quantity === 1 ? t('remove') : t('decrease')}>
          {quantity === 1 ? (
            <Trash2 className="size-4" aria-hidden="true" />
          ) : (
            <Minus className="size-4" aria-hidden="true" />
          )}
        </IconSubmit>
      </form>

      <output
        className="w-11 rounded-sm border border-line-strong py-1.5 text-center text-sm"
        aria-label={t('quantityIs', { count: quantity })}
        data-numeric
      >
        {quantity}
      </output>

      <form action={updateQuantity}>
        <input type="hidden" name="lineId" value={lineId} />
        <input type="hidden" name="quantity" value={quantity + 1} />
        <IconSubmit label={t('increase')} disabled={quantity >= maxQuantity}>
          <Plus className="size-4" aria-hidden="true" />
        </IconSubmit>
      </form>
    </div>
  );
}

export function RemoveLineButton({ lineId }: { lineId: string }) {
  const t = useTranslations('cart');

  return (
    <form action={removeLine}>
      <input type="hidden" name="lineId" value={lineId} />
      <IconSubmit label={t('remove')}>
        <Trash2 className="size-4" aria-hidden="true" />
      </IconSubmit>
    </form>
  );
}
