'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveLoyaltySettings,
  saveReferralSettings,
  savePaymentSettings,
  saveStoreSettings,
  saveTaxSettings,
  type SettingsErrorKey,
  type SettingsState,
} from '@/features/settings/actions';
import { SETTINGS_ERRORS } from '@/features/settings/copy';
import { fromCents } from '@/lib/money';
import type {
  CheckoutSettings,
  LoyaltySettings,
  ReferralSettings,
  StoreSettings,
  SubscriptionSettings,
  TaxSettings,
} from '@/features/settings/queries';

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

function Feedback({ state }: { state: SettingsState }) {
  const error = formError(state);
  return (
    <>
      {state?.ok && (
        <Alert tone="success" className="mt-3">
          {state.data.message ?? 'Saved.'}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  state,
  hint,
  required,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue: string;
  state: SettingsState;
  hint?: string;
  required?: boolean;
  type?: string;
}) {
  const error = fieldError(state, name);
  return (
    <div>
      <label htmlFor={name} className={labelClass}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass}
      />
      {hint && !error && <p className="mt-1 text-[11px] text-ink-500">{hint}</p>}
      {error && (
        <p id={`${name}-error`} className="mt-1 text-[13px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** docs/06 §15 — Store: name, contact, address, socials, announcement. */
export function StoreForm({ settings }: { settings: StoreSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveStoreSettings, null);

  return (
    <ActionForm action={action} state={state}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          name="name"
          label="Shop name"
          defaultValue={settings.name}
          state={state}
          required
        />
        <TextField
          name="email"
          label="Contact email"
          type="email"
          defaultValue={settings.email}
          state={state}
          required
          hint="Shown on the contact page and used as the reply-to on customer emails."
        />
        <TextField name="phone" label="Phone" defaultValue={settings.phone} state={state} />
        <TextField name="address" label="Address" defaultValue={settings.address} state={state} />
        <TextField
          name="instagram"
          label="Instagram"
          defaultValue={settings.instagram}
          state={state}
        />
        <TextField name="tiktok" label="TikTok" defaultValue={settings.tiktok} state={state} />
        <TextField
          name="facebook"
          label="Facebook"
          defaultValue={settings.facebook}
          state={state}
        />
        <TextField
          name="announcement"
          label="Announcement bar"
          defaultValue={settings.announcement}
          state={state}
          hint="Leave empty to hide the bar. Albanian — this is customer-facing."
        />
      </div>

      <div className="mt-4">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save store details
        </SubmitButton>
      </div>
      <Feedback state={state} />
    </ActionForm>
  );
}

/** docs/06 §15 — Tax. The inclusive-pricing flag is stated, not offered. */
export function TaxForm({ settings }: { settings: TaxSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveTaxSettings, null);

  return (
    <ActionForm action={action} state={state}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rate" className={labelClass}>
            VAT rate (%)
          </label>
          <input
            id="rate"
            name="rate"
            type="number"
            step="0.5"
            min={0}
            max={30}
            defaultValue={settings.rate}
            required
            className={inputClass}
            data-numeric
          />
          {fieldError(state, 'rate') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'rate')}</p>
          )}
        </div>

        <div className="rounded-sm border border-line bg-cream p-3 text-xs text-ink-600">
          <p className="font-medium text-ink-900">Prices include VAT</p>
          <p className="mt-1">
            Fixed, and not a preference. Every price in the catalogue is what the customer pays; the
            VAT line on an order is worked back out of it. Changing this would not change a
            calculation — it would change what every price in the shop means.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save tax
        </SubmitButton>
      </div>
      <Feedback state={state} />
    </ActionForm>
  );
}

/** docs/06 §15 — Payments: the two provider toggles plus the basket cap. */
export function PaymentsForm({
  settings,
  bankPosConfigured,
}: {
  settings: CheckoutSettings;
  bankPosConfigured: boolean;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(savePaymentSettings, null);

  return (
    <ActionForm action={action} state={state}>
      <label className="flex items-start gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="codEnabled"
          defaultChecked={settings.codEnabled}
          className="mt-0.5 size-4 rounded-sm border-line-strong"
        />
        <span>
          Cash on delivery
          <span className="block text-xs text-ink-600">
            The only method the shop launches with. Turning it off leaves customers no way to pay.
          </span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 text-sm text-ink-900">
        <input
          type="checkbox"
          name="bankPosEnabled"
          defaultChecked={settings.bankPosEnabled}
          disabled={!bankPosConfigured}
          className="mt-0.5 size-4 rounded-sm border-line-strong"
        />
        <span>
          Bank card (POS)
          <span className="block text-xs text-ink-600">
            {/*
              docs/06 §15: "credentials status readout — values live in env, page shows presence
              only". Never the values, and never an input: a key pasted into a database row is a
              key in a backup, in an export, and in the audit log.
            */}
            {bankPosConfigured
              ? 'Credentials are present in the environment.'
              : 'No credentials configured — set them in the environment before enabling.'}
          </span>
        </span>
      </label>

      <div className="mt-4 max-w-xs">
        <label htmlFor="maxItemQty" className={labelClass}>
          Maximum of one item per order
        </label>
        <input
          id="maxItemQty"
          name="maxItemQty"
          type="number"
          min={1}
          max={100}
          defaultValue={settings.maxItemQty}
          required
          className={inputClass}
          data-numeric
        />
      </div>

      <div className="mt-4">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save payments
        </SubmitButton>
      </div>
      <Feedback state={state} />
    </ActionForm>
  );
}

/** docs/06 §15 — Loyalty and subscriptions in one form; they are one economic decision. */
export function LoyaltyForm({
  loyalty,
  subscriptions,
}: {
  loyalty: LoyaltySettings;
  subscriptions: SubscriptionSettings;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveLoyaltySettings, null);

  return (
    <ActionForm action={action} state={state}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="earnRate" className={labelClass}>
            Points earned per €1 spent
          </label>
          <input
            id="earnRate"
            name="earnRate"
            type="number"
            step="0.5"
            min={0}
            defaultValue={loyalty.earnRatePointsPerEur}
            required
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Awarded when an order is delivered, not when it is placed.
          </p>
        </div>

        {/*
          docs/17 §0.1 — one point value, so the pair of fields changed meaning.

          It used to be "an exchange block of N points is worth €X", which encoded a conversion rate in
          two numbers that could disagree with each other. Now a point has one value in cents, and the
          only other question is the smallest redemption allowed.
        */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="pointValueCents" className={labelClass}>
              A point is worth (cents)
            </label>
            <input
              id="pointValueCents"
              name="pointValueCents"
              type="number"
              min={1}
              max={100}
              defaultValue={loyalty.pointValueCents}
              required
              className={inputClass}
              data-numeric
            />
            <p className="mt-1 text-[11px] text-ink-500">
              1 means 100 points = €1, which is 1% back at the earn rate above.
            </p>
          </div>
          <div>
            <label htmlFor="minRedeemPoints" className={labelClass}>
              Minimum redemption
            </label>
            <input
              id="minRedeemPoints"
              name="minRedeemPoints"
              type="number"
              min={100}
              step={100}
              defaultValue={loyalty.minRedeemPoints}
              required
              className={inputClass}
              data-numeric
            />
            {fieldError(state, 'minRedeemPoints') && (
              <p className="mt-1 text-[13px] text-error">{fieldError(state, 'minRedeemPoints')}</p>
            )}
            <p className="mt-1 text-[11px] text-ink-500">
              Points, in multiples of 100. Keeps the shop out of five-cent coupons.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="subscriptionDiscountPct" className={labelClass}>
            Subscription discount (%)
          </label>
          <input
            id="subscriptionDiscountPct"
            name="subscriptionDiscountPct"
            type="number"
            min={0}
            max={90}
            defaultValue={subscriptions.discountPct}
            required
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Needs a matching active <span className="font-mono">SUB-&lt;pct&gt;</span> coupon — the
            renewal engine applies the discount as that code.
          </p>
        </div>

        <div>
          <label htmlFor="noticeDays" className={labelClass}>
            Days of notice before a renewal
          </label>
          <input
            id="noticeDays"
            name="noticeDays"
            type="number"
            min={0}
            max={30}
            defaultValue={subscriptions.noticeDays}
            required
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            How long before a delivery the &ldquo;skip this one?&rdquo; email goes out.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save loyalty and subscriptions
        </SubmitButton>
      </div>
      <Feedback state={state} />
    </ActionForm>
  );
}

/**
 * docs/17 §2 — the referral programme.
 *
 * Its own section rather than folded into loyalty, even though referral rewards are paid in loyalty
 * points, because the two answer different questions: loyalty is what a point is worth, and this is who
 * gets paid for whose spending. Mixing them would put "1% of a friend's orders" next to "points per
 * euro" and invite somebody to change one meaning to alter the other.
 */
export function ReferralForm({ settings }: { settings: ReferralSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveReferralSettings, null);

  return (
    <ActionForm action={action} state={state}>
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={settings.enabled}
          className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong"
        />
        <span className="text-ink-600">
          Run the programme. Turning it off stops new links and stops accrual; links already
          approved keep the points they earned.
        </span>
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ratePct" className={labelClass}>
            Percent of a referred customer&apos;s spend
          </label>
          <input
            id="ratePct"
            name="ratePct"
            type="number"
            step="0.25"
            min={0}
            max={20}
            defaultValue={settings.ratePct}
            required
            className={inputClass}
            data-numeric
          />
          {fieldError(state, 'ratePct') && (
            <p className="mt-1 text-[13px] text-error">{fieldError(state, 'ratePct')}</p>
          )}
          {/*
            The two things an operator needs to know before changing this: it applies going forward
            only, and the number is written out in the customer-facing terms.
          */}
          <p className="mt-1 text-[11px] text-ink-500">
            Applies to future orders only. The referral terms page states this figure in words —
            change it there too.
          </p>
        </div>

        <div>
          <label htmlFor="durationMonths" className={labelClass}>
            Months a referral keeps earning
          </label>
          <input
            id="durationMonths"
            name="durationMonths"
            type="number"
            min={1}
            max={60}
            defaultValue={settings.durationMonths}
            required
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Counted from approval, not from signup, so a slow queue costs the referrer nothing.
          </p>
        </div>

        <div>
          <label htmlFor="minOrderEur" className={labelClass}>
            Smallest order that counts (€)
          </label>
          <input
            id="minOrderEur"
            name="minOrderEur"
            type="number"
            step="0.01"
            min={0}
            defaultValue={fromCents(settings.minOrderCentsToCount)}
            required
            className={inputClass}
            data-numeric
          />
        </div>

        <div>
          <label htmlFor="maxPointsPerLinkPerYear" className={labelClass}>
            Most one referral can earn (points)
          </label>
          <input
            id="maxPointsPerLinkPerYear"
            name="maxPointsPerLinkPerYear"
            type="number"
            min={0}
            defaultValue={settings.maxPointsPerLinkPerYear}
            required
            className={inputClass}
            data-numeric
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Reaching it pays up to the cap and flags the link for review rather than dropping the
            rest silently.
          </p>
        </div>

        <div>
          <label htmlFor="accrualMode" className={labelClass}>
            When points reach the wallet
          </label>
          <select
            id="accrualMode"
            name="accrualMode"
            defaultValue={settings.accrualMode}
            className={inputClass}
          >
            <option value="monthly">Once a month, as one entry</option>
            <option value="immediate">As each order is delivered</option>
          </select>
          {/*
            This is the privacy control, and the wording says so. Per-order posting turns a referrer's
            own points ledger into a dated list of when a referred customer shopped (docs/17 §0.2).
          */}
          <p className="mt-1 text-[11px] text-ink-500">
            Monthly is the safer default: posting per order tells the referrer the dates their
            friend shopped.
          </p>
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="autoApprove"
          defaultChecked={settings.autoApprove}
          className="mt-0.5 size-4 shrink-0 rounded-[3px] border border-line-strong"
        />
        <span className="text-ink-600">
          Approve a referral automatically once the new customer&apos;s first order is delivered.
          Off means every link waits for a person, which is the launch setting.
        </span>
      </label>

      <div className="mt-4">
        <SubmitButton size="sm" loadingLabel="Saving…">
          Save referrals
        </SubmitButton>
      </div>
      <Feedback state={state} />
    </ActionForm>
  );
}
