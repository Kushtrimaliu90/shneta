import type { Metadata } from 'next';
import { ShippingAdmin } from '@/features/settings/components/shipping-admin';
import { listShippingMethods } from '@/features/settings/queries';

export const metadata: Metadata = { title: 'Shipping' };

/** docs/06 §15 — shipping methods. The layout has already checked the capability. */
export default async function AdminShippingSettingsPage() {
  const rows = await listShippingMethods();

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-forest-900">Shipping methods</h2>
      <p className="mt-0.5 mb-4 max-w-2xl text-sm text-ink-600">
        What customers can choose at checkout, in the order shown. Changing a price or a
        free-delivery threshold takes effect on the shop immediately.
      </p>
      <ShippingAdmin rows={rows} />
    </section>
  );
}
