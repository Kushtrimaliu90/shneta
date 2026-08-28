import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { Alert } from '@/components/ui/alert';
import { CheckoutForm } from '@/features/checkout/components/checkout-form';
import { getProfile } from '@/features/auth/queries';
import {
  getCart,
  getEnabledPaymentProviders,
  getVatRatePercent,
  listShippingMethods,
} from '@/features/cart/queries';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — checkout is per-visitor and never cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'checkout',
  });
  // docs/08 §4 — checkout is not indexed.
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §12 — guest-first checkout. No sign-in wall: the cart is already resolvable from
 * the guest cookie, and requiring an account before a COD order is the single most common way
 * to lose one.
 */
export default async function CheckoutPage({ params }: Props) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  const [cart, methods, providers, vatRatePercent, profile, t] = await Promise.all([
    getCart(),
    listShippingMethods(),
    getEnabledPaymentProviders(),
    getVatRatePercent(),
    getProfile(),
    getTranslations(),
  ]);

  /*
   * Nothing to check out — send them somewhere useful rather than showing an empty form.
   * Localized: a bare `redirect('/cart')` drops an English visitor onto the Albanian cart.
   */
  if (!cart || cart.lines.length === 0) redirect(localizePath('/cart', locale));

  const unavailable = cart.lines.filter((line) => line.stockStatus === 'out_of_stock');

  return (
    <div className="container-page py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
        {t('checkout.title')}
      </h1>

      {cart.prunedSkus.length > 0 && (
        <Alert tone="info" className="mt-6">
          {t('cart.prunedNotice', { count: cart.prunedSkus.length })}
        </Alert>
      )}

      {/*
        docs/07 §3.2 — carting does not reserve stock, so a line can sell out while it sits
        there. Blocking here with a specific message beats letting the RPC raise
        OUT_OF_STOCK after the customer has filled in their address.
      */}
      {unavailable.length > 0 ? (
        <Alert tone="error" className="mt-6" title={t('checkout.blockedTitle')}>
          {t('checkout.blockedBody', {
            skus: unavailable.map((line) => line.sku).join(', '),
          })}
        </Alert>
      ) : (
        <div className="mt-8">
          <CheckoutForm
            cart={cart}
            methods={methods}
            providers={providers}
            vatRatePercent={vatRatePercent}
            defaultEmail={profile?.email}
            defaultPhone={profile?.phone ?? undefined}
            defaultName={profile?.fullName}
          />
        </div>
      )}
    </div>
  );
}
