'use client';

import { useActionState } from 'react';
import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveLoyaltySettings,
  savePaymentSettings,
  saveStoreSettings,
  saveTaxSettings,
  type SettingsErrorKey,
  type SettingsState,
} from '@/features/settings/actions';
import { SETTINGS_ERRORS } from '@/features/settings/copy';
import type {
  CheckoutSettings,
  LoyaltySettings,
  StoreSettings,
  SubscriptionSettings,
  TaxSettings,
} from '@/features/settings/queries';
import { fromCents } from '@/lib/money';

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
    <form action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField name="name" label="Shop name" defaultValue={settings.name} state={state} required />
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
        <TextField name="facebook" label="Facebook" defaultValue={settings.facebook} state={state} />
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
    </form>
  );
}

/** docs/06 §15 — Tax. The inclusive-pricing flag is stated, not offered. */
export function TaxForm({ settings }: { settings: TaxSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(saveTaxSettings, null);

  return (
    <form action={action}>
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
            Fixed, and not a preference. Every price in the catalogue is what the customer pays;
            the VAT line on an order is worked back out of it. Changing this would not change a
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
    </form>
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
    <form action={action}>
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
    </form>
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
    <form action={action}>
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

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="redeemPoints" className={labelClass}>
              Exchange block
            </label>
            <input
              id="redeemPoints"
              name="redeemPoints"
              type="number"
              min={1}
              defaultValue={loyalty.redeemPoints}
              required
              className={inputClass}
              data-numeric
            />
          </div>
          <div>
            <label htmlFor="redeemValue" className={labelClass}>
              is worth (€)
            </label>
            <input
              id="redeemValue"
              name="redeemValue"
              defaultValue={fromCents(loyalty.redeemValueCents)}
              required
              className={inputClass}
              data-numeric
            />
            {fieldError(state, 'redeemValue') && (
              <p className="mt-1 text-[13px] text-error">{fieldError(state, 'redeemValue')}</p>
            )}
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
    </form>
  );
}
