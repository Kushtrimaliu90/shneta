import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { resolveLocale } from '@/i18n/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderLookupForm } from '@/features/checkout/components/order-lookup-form';

type Props = { params: Promise<{ locale: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'order.lookup',
  });
  // docs/08 §4 allows this to be indexed — it is a public entry point with no order data on it.
  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: {
      canonical: '/order-lookup',
      languages: { sq: '/order-lookup', en: '/en/order-lookup' },
    },
  };
}

/** docs/05 §13 — the guest entry point for tracking an order without an account. */
export default async function OrderLookupPage({ params }: Props) {
  setRequestLocale(resolveLocale((await params).locale));
  const t = await getTranslations('order.lookup');

  return (
    <div className="container-page py-12 lg:py-16">
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OrderLookupForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
