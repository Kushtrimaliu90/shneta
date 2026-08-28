import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { localizePath } from '@/lib/i18n';
import { formatPrice } from '@/lib/money';
import type { Locale } from '@/lib/constants';
import { buttonVariants } from '@/components/ui/button';
import { OrderSummary } from '@/features/checkout/components/order-summary';
import { getOrderByAccessCookie } from '@/features/checkout/order-access';

type Props = { params: Promise<{ locale: string; orderNumber: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'order',
  });
  return { title: t('successTitle'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §12 — the success page.
 *
 * **Gated on the access-token cookie, not the order number** (docs/13 §B1). Order numbers are
 * partly sequential and appear in emails and on invoices, so treating one as proof of
 * ownership would let anyone walk the sequence and read every customer's name, address, phone
 * and items. Without the cookie this redirects to `/order-lookup`, which asks for the email
 * as well and is rate-limited.
 *
 * That also means the page is not shareable or bookmarkable, which is correct: someone
 * returning to it days later should authenticate through lookup or their account.
 */
export default async function CheckoutSuccessPage({ params }: Props) {
  const { locale: rawLocale, orderNumber } = await params;
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const order = await getOrderByAccessCookie(orderNumber);
  // Localized, or an English customer is bounced into the Albanian lookup form.
  if (!order) redirect(localizePath('/order-lookup', locale));

  const t = await getTranslations();

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-2xl">
        <div className="text-center">
          {/* Seated in a disc rather than floating bare — the page's one moment of relief. */}
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-forest-50">
            <CheckCircle2 className="size-8 text-forest-700" aria-hidden="true" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
            {t('order.successTitle')}
          </h1>
          <p className="mt-3 text-ink-600">{t('order.successBody')}</p>

          <p className="mt-6 inline-block rounded-md border border-line bg-surface px-4 py-2.5">
            <span className="block eyebrow">{t('order.orderNumber')}</span>
            <span className="font-display text-2xl font-semibold text-forest-900" data-numeric>
              {order.orderNumber}
            </span>
          </p>
        </div>

        {/*
          docs/05 §12 — COD amount to prepare, stated plainly and early. The amount is the
          one number the customer acts on, so it gets its own line at price scale rather
          than sitting at 14px mid-sentence; the courier sentence supports it below.
        */}
        <div className="mt-8 rounded-lg bg-forest-50 p-5 text-center">
          <p className="font-medium text-forest-900">{t('order.codHeading')}</p>
          <p className="mt-3">
            <span className="block eyebrow">{t('order.codAmountLabel')}</span>
            <span className="font-display text-3xl font-semibold text-forest-900" data-numeric>
              {formatPrice(order.totalCents, locale)}
            </span>
          </p>
          <p className="mt-1.5 text-sm text-ink-600">{t('order.codSupport')}</p>
        </div>

        <div className="mt-10">
          <OrderSummary order={order} />
        </div>

        <div className="mt-10 border-t border-line pt-6 text-center">
          <p className="text-sm text-ink-600">{t('order.trackNote')}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {/*
              The page's primary action: the order is done, so the strongest button leads
              back into the shop. Lookup is the fallback for "did that really go through?".
            */}
            <Link href="/shop" className={buttonVariants()}>
              {t('order.continueShopping')}
            </Link>
            <Link href="/order-lookup" className={buttonVariants({ variant: 'secondary' })}>
              {t('footer.orderLookup')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
