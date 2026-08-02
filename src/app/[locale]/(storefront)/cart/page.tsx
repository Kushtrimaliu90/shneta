import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { ShoppingBag } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { CartLines } from '@/features/cart/components/cart-lines';
import { FreeShippingProgress } from '@/features/cart/components/free-shipping-progress';
import { getCart } from '@/features/cart/queries';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — the cart is per-visitor, so it is never cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'cart',
  });
  // docs/08 §4 — the cart is not indexed.
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** docs/05 §12 — cart page: lines, coupon field, notes, totals, and one clear next action. */
export default async function CartPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [cart, t] = await Promise.all([getCart(), getTranslations()]);
  const hasLines = (cart?.lines.length ?? 0) > 0;

  return (
    <div className="container-page py-8 lg:py-12">
      <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-4xl">
        {t('cart.title')}
      </h1>

      {/* docs/07 §3.2 — say what was pruned; never let the total change silently. */}
      {cart && cart.prunedSkus.length > 0 && (
        <Alert tone="info" className="mt-6">
          {t('cart.prunedNotice', { count: cart.prunedSkus.length })}
        </Alert>
      )}

      {!hasLines || !cart ? (
        <EmptyState
          icon={ShoppingBag}
          title={t('cart.empty.title')}
          body={t('cart.empty.body')}
          className="mt-8"
          action={
            <Link href="/shop" className={buttonVariants()}>
              {t('common.browseShop')}
            </Link>
          }
        />
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
          <section aria-label={t('cart.linesLabel')}>
            <CartLines lines={cart.lines} />
          </section>

          {/* docs/05 §12 — persistent order summary on the right at desktop widths. */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-lg border border-line bg-surface p-5">
              <h2 className="font-display text-lg font-semibold text-forest-900">
                {t('cart.summary')}
              </h2>

              <dl className="mt-4 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t('cart.subtotal')}</dt>
                  <dd className="font-medium text-ink-900" data-numeric>
                    {formatPrice(cart.subtotalCents, locale)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">{t('cart.shipping')}</dt>
                  {/* Shipping depends on the method chosen at checkout, so it is honest to
                      say "calculated next" rather than guess a number here. */}
                  <dd className="text-ink-500">{t('cart.shippingAtCheckout')}</dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-line pt-4">
                <FreeShippingProgress
                  subtotalCents={cart.subtotalCents}
                  thresholdCents={cart.freeShippingThresholdCents}
                />
              </div>

              <Link
                href="/checkout"
                className={cn(buttonVariants({ size: 'lg', block: true }), 'mt-5')}
              >
                {t('cart.checkout')}
              </Link>

              <p className="mt-3 text-center text-xs text-ink-500">{t('cart.codNote')}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
