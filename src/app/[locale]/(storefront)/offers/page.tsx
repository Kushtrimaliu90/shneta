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
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

// Keep in sync with `ISR_REVALIDATE_SECONDS` — segment config must be a literal.
export const revalidate = 3600;

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
    <div className="container-wide py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-600">{t('intro')}</p>
      </header>

      {/*
        The campaign banner is a filled band, not an info box. It used to wear the forest-50
        outline recipe the FAQ and account notices wear, which made the excitement page quieter
        than the help page. `bg-forest-900 text-cream` is the announcement bar's register
        (announcement-bar.tsx), and the CTA carries this page's single lime accent — legitimate
        since the product cards' sale badges went forest-on-white, and the same
        lime-on-dark-only rule the hero applies (hero-slide.tsx).
      */}
      {banner && (
        <div className="mb-8 rounded-xl bg-forest-900 p-6 text-cream lg:p-8">
          <p className="font-display text-2xl font-semibold lg:text-3xl">
            {pickLocale(banner.title, locale)}
          </p>
          {pickLocale(banner.subtitle, locale) && (
            <p className="mt-1 text-cream/80">{pickLocale(banner.subtitle, locale)}</p>
          )}
          {banner.ctaHref && pickLocale(banner.ctaLabel, locale) && (
            <Link
              href={banner.ctaHref}
              className={cn(
                buttonVariants({ size: 'sm' }),
                'mt-4 bg-lime-500 text-lime-950 hover:bg-lime-400',
              )}
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
              <h2 className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl">
                {t('couponsTitle')}
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
                {coupons.map((coupon) => (
                  <CouponCard key={coupon.code} coupon={coupon} />
                ))}
              </ul>
            </section>
          )}

          {onSale.items.length > 0 && (
            <section>
              <h2 className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl">
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
