import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { getMyMerchant } from '@/features/merchants/queries';
import { MerchantSettingsForm } from '@/features/merchants/components/merchant-settings-form';

export const metadata: Metadata = { title: 'Cilësimet' };
export const dynamic = 'force-dynamic';

/**
 * docs/16 §5 — the merchant's own details.
 *
 * Available at every status, including `pending`: a merchant correcting a mistyped phone number
 * before approval should not have to email somebody about it. What they cannot change — the legal
 * name, the ARBK number, the commission — is refused by `guard_merchant_self_update` rather than by
 * this page, so the boundary holds whichever route reaches the table.
 */
export default async function MerchantSettingsPage() {
  const merchant = await getMyMerchant();
  if (!merchant) return null;

  const t = await getTranslations('merchant.settings');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('title')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('intro')}</p>
      </header>

      <MerchantSettingsForm merchant={merchant} />
    </div>
  );
}
