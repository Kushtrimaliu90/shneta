import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Tag } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { listProducts } from '@/features/catalog/queries';
import { listBanners, listPublicCoupons } from '@/features/content/queries';
import { CouponCard } from '@/features/content/components/coupon-card';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'offers' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: { canonical: '/offers', languages: { sq: '/offers', en: '/en/offers' } },
  };
}

/**
 * docs/05 §11 — offers.
 *
 * Two things a shopper came for: what is discounted, and what codes exist. The on-sale grid is
 * `listProducts({ onSale: true })`, so it is the same query, the same cards and the same
 * ranking as the shop — a second implementation would eventually disagree with the first about
 * what "on sale" means.
 *
 * The coupons come from `list_public_coupons()`, which owns the definition of claimable. The
 * page cannot accidentally render an expired code because it never sees one — that is the
 * acceptance criterion, and it is enforced a layer below this file.
 */
export default async function OffersPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [onSale, coupons, banners, t] = await Promise.all([
    listProducts({ onSale: true, sort: 'newest' }),
    listPublicCoupons(),
    listBanners('offers'),
    getTranslations('offers'),
  ]);

  const banner = banners[0];
  const nothing = onSale.items.length === 0 && coupons.length === 0;

  return (
    <div className="container-page py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-600">{t('intro')}</p>
      </header>

      {banner && (
        <div className="mb-8 rounded-xl border border-carbon-800 bg-carbon-50 p-5 lg:p-6">
          <p className="font-display text-xl font-semibold text-carbon-900">
            {pickLocale(banner.title, locale)}
          </p>
          {pickLocale(banner.subtitle, locale) && (
            <p className="mt-1 text-ink-600">{pickLocale(banner.subtitle, locale)}</p>
          )}
          {banner.ctaHref && pickLocale(banner.ctaLabel, locale) && (
            <Link
              href={banner.ctaHref}
              className={buttonVariants({ size: 'sm', className: 'mt-4' })}
            >
              {pickLocale(banner.ctaLabel, locale)}
            </Link>
          )}
        </div>
      )}

      {nothing ? (
        <EmptyState
          icon={Tag}
          title={t('noSale')}
          body={t('noCoupons')}
          action={
            <Link href="/shop" className={buttonVariants({ size: 'sm' })}>
              {t('browseShop')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-12">
          {coupons.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-semibold text-carbon-900">
                {t('couponsTitle')}
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {coupons.map((coupon) => (
                  <CouponCard key={coupon.code} coupon={coupon} />
                ))}
              </ul>
            </section>
          )}

          {onSale.items.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-semibold text-carbon-900">
                {t('onSaleTitle')}{' '}
                <span className="font-ui text-sm font-normal text-ink-500" data-numeric>
                  {onSale.total}
                </span>
              </h2>
              <div className="mt-4">
                <ProductGrid result={onSale} hasFilters={false} clearHref="/shop" />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
