import type { Metadata } from 'next';
import { getAllSettings } from '@/features/settings/queries';
import {
  LoyaltyForm,
  PaymentsForm,
  ReferralForm,
  StoreForm,
  TaxForm,
} from '@/features/settings/components/settings-forms';
import { serverEnv } from '@/lib/env.server';

export const metadata: Metadata = { title: 'Settings' };

/** docs/06 §15 — store, tax, payments, loyalty. The layout has already checked the capability. */
export default async function AdminSettingsPage() {
  const settings = await getAllSettings();

  /*
   * Presence, not the value, and computed on the server so the key never reaches a bundle.
   * docs/06 §15: "values live in env, page shows presence only".
   */
  const bankPosConfigured = Boolean(serverEnv.BANK_POS_MERCHANT_ID);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Shop details" description="Where customers find you, and what they see.">
        <StoreForm settings={settings.store} />
      </Section>

      <Section title="Tax" description="Kosovo VAT. Prices in the catalogue already include it.">
        <TaxForm settings={settings.tax} />
      </Section>

      <Section title="Payments" description="How customers can pay, and how much they can buy.">
        <PaymentsForm settings={settings.checkout} bankPosConfigured={bankPosConfigured} />
      </Section>

      <Section
        title="Loyalty and subscriptions"
        description="What a point is worth, and what subscribing saves."
      >
        <LoyaltyForm loyalty={settings.loyalty} subscriptions={settings.subscriptions} />
      </Section>

      <Section
        title="Referrals"
        description="Who gets paid for whose spending, and when the points arrive."
      >
        <ReferralForm settings={settings.referral} />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-display text-lg font-semibold text-forest-900">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-ink-600">{description}</p>
      {children}
    </section>
  );
}
