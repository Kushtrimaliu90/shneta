import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { createPublicClient } from '@/lib/supabase/public';
import type { Locale } from '@/lib/constants';
import { MerchantApplyForm } from '@/features/merchants/components/apply-form';

type Props = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'merchant.apply' });

  return {
    title: t('title'),
    description: t('intro'),
    /*
     * Indexed, unlike the rest of `/merchant`. This is the one marketplace page written for someone
     * who has not heard of the programme yet, and "sell supplements online in Kosovo" is a search a
     * prospective merchant actually makes.
     */
    alternates: {
      canonical: '/merchant/apply',
      languages: { sq: '/merchant/apply', en: '/en/merchant/apply' },
    },
  };
}

/**
 * docs/16 §4 — the public application.
 *
 * The one page under `/merchant` that does not require a session, exempted by exact match in the
 * middleware. Everything else there is the portal.
 */
export default async function MerchantApplyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'merchant.apply' });

  /*
   * The default commission, read so the form can state the number rather than a placeholder.
   *
   * Anon client and the public `settings` read — the same path the shipping threshold and the tax
   * rate already use. A merchant's *actual* commission is set at approval and may differ; the copy
   * says "typically", because promising a number BioCode has not agreed to would be worse than
   * showing none.
   */
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'marketplace')
    .maybeSingle();

  const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
  const commissionDefault =
    typeof value.default_commission_pct === 'number' ? value.default_commission_pct : 15;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <p className="font-ui text-xs font-semibold tracking-wider text-forest-700 uppercase">
        {t('eyebrow')}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-forest-900 sm:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 text-ink-600">{t('intro')}</p>

      <ul className="mt-6 flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 text-sm text-ink-900">
        <li>{t('point1')}</li>
        <li>{t('point2')}</li>
        <li>{t('point3')}</li>
      </ul>

      <div className="mt-10">
        <MerchantApplyForm commissionDefault={commissionDefault} />
      </div>
    </div>
  );
}
