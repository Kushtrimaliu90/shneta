'use client';

import { useActionState, useState } from 'react';
import { Banknote, Play } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  buildPayoutRun,
  markPayoutPaid,
  postAdjustment,
  type PayoutState,
} from '@/features/merchants/payout-actions';
import { firstFailure } from '@/features/merchants/action-state';
import type { MerchantOwing, PayoutRow } from '@/features/merchants/payout-queries';

/**
 * docs/16 §8 — the payout run, and recording the transfers.
 *
 * ── Two buttons, deliberately far apart ──
 *
 * **Build** cuts statements and moves nothing. **Mark paid** records a transfer somebody has already
 * made at a banking screen. They are separate because they happen at different times and because
 * combining them would mean a statement could only exist once the money had gone — so a merchant asking
 * "what will I be paid?" could not be answered until after they had been.
 *
 * Building is safe to press twice: the run posts a balancing ledger row, so a second build of the same
 * period settles nothing. That is worth knowing while looking at the button.
 *
 * Admin UI is English-only (CLAUDE.md §3).
 */
export function PayoutAdmin({
  payouts,
  owed,
  defaultPeriod,
}: {
  payouts: PayoutRow[];
  owed: MerchantOwing[];
  defaultPeriod: { start: string; end: string };
}) {
  const [runState, run] = useActionState<PayoutState, FormData>(
    async (previous, formData) => buildPayoutRun(previous, formData),
    null,
  );

  const failure = firstFailure([runState]);
  const totalOwed = owed.reduce((sum, entry) => sum + entry.balanceCents, 0);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="run" className="flex flex-col gap-4">
        <h2 id="run" className="font-display text-lg font-semibold text-forest-900">
          Build the run
        </h2>

        <ActionForm
          action={run}
          state={runState}
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        >
          <p className="text-sm text-ink-600">
            Cuts a statement for every merchant with something owed in the period, and balances each
            one&rsquo;s ledger by the amount of the statement. It moves no money — the transfers are
            below. Pressing it twice for the same period settles nothing the second time.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">Period start</span>
              <input
                type="date"
                name="periodStart"
                defaultValue={defaultPeriod.start}
                className="h-11 rounded-sm border border-line-strong bg-surface px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">Period end</span>
              <input
                type="date"
                name="periodEnd"
                defaultValue={defaultPeriod.end}
                className="h-11 rounded-sm border border-line-strong bg-surface px-3 text-sm"
              />
            </label>
          </div>

          {/* Prefilled with the fortnight that just closed — the normal case needs no typing. */}
          <p className="text-[13px] text-ink-500">
            Defaults to the fortnight that has just closed. The cron does this on the 1st and the
            16th.
          </p>

          {runState?.ok && (
            <p role="status" aria-live="polite" className="text-sm font-medium text-success">
              Built {runState.data.built} statement(s).
            </p>
          )}
          {failure && (
            <p role="alert" className="text-sm text-error">
              {failure.error === 'payouts.errors.nothingToSettle'
                ? 'Nothing owed in that period, so no statements were written.'
                : failure.error === 'admin.errors.forbidden'
                  ? 'Payouts are admin-only.'
                  : 'Could not build the run.'}
            </p>
          )}

          <div>
            <SubmitButton size="sm">
              <Play className="size-4" aria-hidden="true" />
              Build statements
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="owed" className="flex flex-col gap-3">
        <h2 id="owed" className="font-display text-lg font-semibold text-forest-900">
          Outstanding balances
        </h2>

        {owed.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            Every merchant is settled. Balances appear here as fulfilments are delivered.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-600">
              {formatPrice(totalOwed, 'en')} across {owed.length} merchant(s), unsettled.
            </p>
            <ul className="flex flex-col gap-2">
              {owed.map((entry) => (
                <li key={entry.merchantId}>
                  <OwingRow entry={entry} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="statements" className="flex flex-col gap-3">
        <h2 id="statements" className="font-display text-lg font-semibold text-forest-900">
          Statements
        </h2>

        {payouts.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-6 text-center text-sm text-ink-600">
            No statements yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payouts.map((payout) => (
              <li key={payout.id}>
                <PayoutCard payout={payout} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One merchant's balance, with an adjustment form behind a toggle.
 *
 * The adjustment is here rather than on its own screen because this is where somebody looking at a
 * wrong number is standing. It requires a note: the ledger is append-only, so an adjustment is
 * permanent, and one without a reason is indistinguishable from a mistake three months later.
 */
function OwingRow({ entry }: { entry: MerchantOwing }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<PayoutState, FormData>(async (previous, formData) => {
    const result = await postAdjustment(previous, formData);
    if (result?.ok) setOpen(false);
    return result;
  }, null);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium text-ink-900">{entry.merchantName}</span>
        <span className="flex items-center gap-3">
          <span
            className={cn(
              'font-ui font-semibold',
              entry.balanceCents < 0 ? 'text-error' : 'text-forest-900',
            )}
            data-numeric
          >
            {entry.balanceCents < 0 ? '−' : ''}
            {formatPrice(Math.abs(entry.balanceCents), 'en')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
            Adjust
          </Button>
        </span>
      </div>

      {open && (
        <ActionForm
          action={action}
          state={state}
          className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
        >
          <input type="hidden" name="merchantId" value={entry.merchantId} />

          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">Amount (€)</span>
              <input
                name="amountEuro"
                type="text"
                inputMode="decimal"
                required
                placeholder="-12.50"
                className="h-10 rounded-sm border border-line-strong bg-surface px-2.5 text-sm"
              />
              <span className="text-xs text-ink-600">Negative takes money off the merchant.</span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-ink-900">Why</span>
              <input
                name="note"
                required
                minLength={5}
                className="h-10 rounded-sm border border-line-strong bg-surface px-2.5 text-sm"
              />
              <span className="text-xs text-ink-600">
                The merchant reads this on its statement. Required, and permanent.
              </span>
            </label>
          </div>

          {state && !state.ok && (
            <p role="alert" className="text-sm text-error">
              Could not post the adjustment. Check the amount and the note.
            </p>
          )}

          <div className="flex gap-2">
            <SubmitButton size="sm">Post adjustment</SubmitButton>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

function PayoutCard({ payout }: { payout: PayoutRow }) {
  const [state, action] = useActionState<PayoutState, FormData>(
    async (previous, formData) => markPayoutPaid(previous, formData),
    null,
  );

  const payable = payout.status === 'pending' || payout.status === 'approved';

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink-900">{payout.merchantName ?? 'Merchant'}</p>
          <p className="text-[13px] text-ink-500" data-numeric>
            {payout.periodStart} – {payout.periodEnd}
          </p>
        </div>
        <div className="text-right">
          <p className="font-ui font-semibold text-forest-900" data-numeric>
            {formatPrice(payout.netCents, 'en')}
          </p>
          <p className="text-[13px] text-ink-500">
            gross {formatPrice(payout.grossCents, 'en')} · commission{' '}
            {formatPrice(payout.commissionCents, 'en')}
          </p>
        </div>
      </div>

      {payout.status === 'paid' ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Banknote className="size-4" aria-hidden="true" />
          Paid {payout.paidAt?.slice(0, 10)} · ref <span data-numeric>{payout.reference}</span>
        </p>
      ) : payable ? (
        <ActionForm
          action={action}
          state={state}
          className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
        >
          <input type="hidden" name="payoutId" value={payout.id} />
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Bank reference</span>
            <input
              name="reference"
              required
              minLength={3}
              placeholder="BKT-2026-0001"
              className="h-10 rounded-sm border border-line-strong bg-surface px-2.5 text-sm"
            />
          </label>
          <SubmitButton size="sm">Mark paid</SubmitButton>

          {state && !state.ok && (
            <p role="alert" className="w-full text-sm text-error">
              {state.error === 'payouts.errors.referenceRequired'
                ? 'A bank reference is required — a payout with nothing to trace it by is not recorded.'
                : state.error === 'payouts.errors.notPayable'
                  ? 'This statement is no longer payable. Reload the page.'
                  : 'Could not record the payment.'}
            </p>
          )}
        </ActionForm>
      ) : (
        <p className="text-sm text-ink-600">On hold.</p>
      )}
    </article>
  );
}
