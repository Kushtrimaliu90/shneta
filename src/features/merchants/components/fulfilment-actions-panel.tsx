'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, PackageCheck, Truck, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  acceptFulfilment,
  declineFulfilment,
  markFulfilmentPacked,
  shipFulfilment,
  type FulfilmentState,
} from '@/features/merchants/fulfilment-actions';
import type { FulfilmentDetail } from '@/features/merchants/fulfilment-queries';
import { firstFailure } from '@/features/merchants/action-state';

const LEAVES = [
  'generic',
  'invalid',
  'notMerchant',
  'notYours',
  'wrongState',
  'trackingRequired',
] as const;

type Leaf = (typeof LEAVES)[number];

function leaf(error: string): Leaf {
  const last = error.split('.').pop() ?? 'generic';
  return (LEAVES as readonly string[]).includes(last) ? (last as Leaf) : 'generic';
}

/**
 * docs/16 §7 — the merchant's lane, as buttons.
 *
 * **One action is offered at a time**, and that is the design rather than an omission. A panel showing
 * accept, pack and ship at once invites a merchant to click "shipped" on a parcel they have not packed
 * — the trigger would refuse it, but a refused click is a worse experience than a button that was
 * never there. The state machine is in the database; this reflects it.
 *
 * `delivered` is absent and stays absent: courier confirmation is BioCode's to record, because a
 * merchant that could mark its own parcels delivered could trigger its own payout.
 */
export function FulfilmentActionsPanel({ fulfilment }: { fulfilment: FulfilmentDetail }) {
  const t = useTranslations('merchant.fulfilments');
  const [declining, setDeclining] = useState(false);

  const [acceptState, accept] = useActionState<FulfilmentState, FormData>(
    async (previous, formData) => acceptFulfilment(previous, formData),
    null,
  );
  const [packState, pack] = useActionState<FulfilmentState, FormData>(
    async (previous, formData) => markFulfilmentPacked(previous, formData),
    null,
  );
  const [shipState, ship] = useActionState<FulfilmentState, FormData>(
    async (previous, formData) => shipFulfilment(previous, formData),
    null,
  );
  const [declineState, decline] = useActionState<FulfilmentState, FormData>(
    async (previous, formData) => declineFulfilment(previous, formData),
    null,
  );

  const failure = firstFailure([acceptState, packState, shipState, declineState]);

  if (fulfilment.status === 'assigned') {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-warning/40 bg-warning/5 p-4">
        <div>
          <p className="font-medium text-ink-900">{t('decide')}</p>
          <p className="mt-0.5 text-sm text-ink-600">{t('decideHint')}</p>
        </div>

        {failure && <Alert tone="error">{t(`errors.${leaf(failure.error)}`)}</Alert>}

        <div className="flex flex-wrap gap-2">
          <form action={accept}>
            <input type="hidden" name="fulfilmentId" value={fulfilment.id} />
            <SubmitButton size="sm">
              <Check className="size-4" aria-hidden="true" />
              {t('accept')}
            </SubmitButton>
          </form>

          <Button variant="secondary" size="sm" onClick={() => setDeclining(!declining)}>
            <X className="size-4" aria-hidden="true" />
            {t('decline')}
          </Button>
        </div>

        {declining && (
          <ActionForm
            action={decline}
            state={declineState}
            className="flex flex-col gap-3 border-t border-line pt-4"
          >
            <input type="hidden" name="fulfilmentId" value={fulfilment.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">{t('declineReason')}</span>
              <textarea
                name="reason"
                rows={2}
                required
                minLength={5}
                className="rounded-sm border border-line-strong bg-surface p-2.5 text-sm"
              />
              {/* The reason goes back to BioCode with the order, and the scorecard reads it (§6). */}
              <span className="text-[13px] text-ink-500">{t('declineReasonHint')}</span>
            </label>
            <div>
              <SubmitButton size="sm" variant="destructive">
                {t('confirmDecline')}
              </SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    );
  }

  if (fulfilment.status === 'accepted') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="font-medium text-ink-900">{t('nextPack')}</p>
        {failure && <Alert tone="error">{t(`errors.${leaf(failure.error)}`)}</Alert>}
        <form action={pack}>
          <input type="hidden" name="fulfilmentId" value={fulfilment.id} />
          <SubmitButton size="sm">
            <PackageCheck className="size-4" aria-hidden="true" />
            {t('markPacked')}
          </SubmitButton>
        </form>
      </div>
    );
  }

  if (fulfilment.status === 'packed') {
    return (
      <ActionForm
        action={ship}
        state={shipState}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <input type="hidden" name="fulfilmentId" value={fulfilment.id} />
        <div>
          <p className="font-medium text-ink-900">{t('nextShip')}</p>
          <p className="mt-0.5 text-sm text-ink-600">{t('shipHint')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="carrier" label={t('carrier')} required>
            {(field) => <Input {...field} name="carrier" autoComplete="off" />}
          </Field>
          <Field id="trackingCode" label={t('trackingCode')} required>
            {(field) => <Input {...field} name="trackingCode" autoComplete="off" />}
          </Field>
        </div>

        {failure && <Alert tone="error">{t(`errors.${leaf(failure.error)}`)}</Alert>}

        <div>
          <SubmitButton size="sm">
            <Truck className="size-4" aria-hidden="true" />
            {t('markShipped')}
          </SubmitButton>
        </div>
      </ActionForm>
    );
  }

  /*
   * Shipped, delivered, cancelled, returned, or still unassigned — nothing for the merchant to do.
   * Stated rather than left blank, because an empty panel reads as a screen that failed to load.
   */
  return (
    <p className="rounded-lg border border-line bg-cream p-4 text-sm text-ink-600">
      {fulfilment.status === 'unassigned' ? t('notYetAssigned') : t('nothingToDo')}
    </p>
  );
}
