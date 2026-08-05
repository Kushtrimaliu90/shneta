import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import {
  getMyMerchant,
  marketplaceMaxHandlingDays,
  searchCatalogVariants,
  settlementByUnitPrice,
} from '@/features/merchants/queries';
import { OfferForm } from '@/features/merchants/components/offer-form';

export const metadata: Metadata = { title: 'Ofertë e re' };
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * docs/16 §5 — adding an offer against a canonical product.
 *
 * The picker is BioCode's published catalogue and nothing else: **merchants never create products**
 * (§1), because the moment they can, the same tub of vitamin D becomes three pages, three review
 * pools and three URLs competing in search, and "who else has this in stock?" stops being a
 * computable question.
 *
 * A merchant who needs a product BioCode does not list submits a **proposal**, which is step 6. Until
 * then the search returning nothing is the honest answer, and the empty state says so.
 *
 * The search term arrives in `?q=` as a plain GET form rather than client state, so the list is
 * server-rendered, works before hydration, and is linkable. A twenty-row cap keeps one round trip to
 * `merchant_settlement_units` small; the counter-argument — that a merchant with a long catalogue
 * scrolls — is answered by searching, which is what the field is for.
 */
export default async function NewOfferPage({ params, searchParams }: Props) {
  const locale = resolveLocale((await params).locale);
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') notFound();

  const query = await searchParams;
  const rawTerm = Array.isArray(query.q) ? query.q[0] : query.q;
  const term = (rawTerm ?? '').slice(0, 80);

  const t = await getTranslations('merchant.offers');

  const [variants, maxHandling] = await Promise.all([
    searchCatalogVariants(term),
    marketplaceMaxHandlingDays(),
  ]);

  const settlement = await settlementByUnitPrice(
    merchant.id,
    variants.map((variant) => variant.retailPriceCentsInternal),
  );

  /*
   * Keyed by variant id for the form, resolved from the price map here. The form should not have to know
   * that two variants at the same price share an answer.
   *
   * This is also where BioCode's shelf price stops. The settlement figure — what the merchant is paid per
   * unit — crosses to the client; the price it was derived from does not (owner decision, 2026-08-05).
   */
  const perVariant: Record<string, number> = {};
  for (const variant of variants) {
    perVariant[variant.variantId] = settlement.get(variant.retailPriceCentsInternal) ?? 0;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-display text-xl font-semibold text-forest-900">{t('form.newTitle')}</h2>
        <p className="mt-1 text-sm text-ink-600">{t('form.newIntro')}</p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-medium text-ink-900">
            {t('form.search')}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={term}
            placeholder={t('form.searchPlaceholder')}
            className="h-11 w-full rounded-sm border border-line-strong bg-surface px-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-sm border border-line-strong px-4 text-sm font-medium text-forest-800 hover:bg-forest-50"
        >
          {t('form.searchSubmit')}
        </button>
      </form>

      {variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-8 text-center">
          <p className="text-sm text-ink-600">
            {term ? t('form.noMatches', { term }) : t('form.noCatalogue')}
          </p>
          <p className="mt-2 text-[13px] text-ink-500">{t('form.proposalComing')}</p>
          <Link
            href="/merchant/offers"
            className="mt-4 inline-block text-sm text-forest-800 underline"
          >
            {t('form.backToOffers')}
          </Link>
        </div>
      ) : (
        <OfferForm
          mode="create"
          locale={locale}
          variants={variants}
          settlementPerUnitCents={perVariant}
          maxHandlingDays={maxHandling}
        />
      )}
    </div>
  );
}
