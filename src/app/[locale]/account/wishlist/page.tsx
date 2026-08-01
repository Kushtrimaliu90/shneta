import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Heart } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { ProductImage } from '@/components/storefront/product-image';
import { PriceTag } from '@/components/storefront/price-tag';
import { listWishlist } from '@/features/wishlist/queries';
import { WishlistProvider } from '@/features/wishlist/components/wishlist-provider';
import { WishlistButton } from '@/features/wishlist/components/wishlist-button';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ locale: string }> };

/** docs/02 §5 — per-visitor, never cached. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({
    locale: resolveLocale((await params).locale),
    namespace: 'wishlist',
  });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * docs/05 §14 — the wishlist.
 *
 * The heart on each row removes the item, and because the button is optimistic the card stays
 * on screen with an empty heart until the next navigation. That is deliberate: a row that
 * vanishes the instant it is tapped makes an accidental tap unrecoverable, whereas an unfilled
 * heart can simply be tapped again.
 */
export default async function AccountWishlistPage({ params }: Props) {
  const locale = resolveLocale((await params).locale) as Locale;
  setRequestLocale(locale);

  const [items, t] = await Promise.all([listWishlist(), getTranslations()]);

  if (items.length === 0) {
    return (
      <div>
        <h2 className="font-display text-2xl font-semibold text-forest-900">
          {t('wishlist.title')}
        </h2>
        <EmptyState
          icon={Heart}
          title={t('wishlist.empty')}
          body={t('wishlist.emptyHint')}
          className="mt-6"
          action={
            <Link href="/shop" className={buttonVariants({ size: 'sm' })}>
              {t('compare.browseShop')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-forest-900">{t('wishlist.title')}</h2>
      <p className="mt-1 text-sm text-ink-600" data-numeric>
        {t('wishlist.itemCount', { count: items.length })}
      </p>

      <WishlistProvider>
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => {
            const name = pickLocale(item.name, locale);

            return (
              <li
                key={item.productId}
                className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-sm bg-cream">
                  <ProductImage
                    path={item.imagePath}
                    alt={name}
                    sizes="64px"
                    className="size-16 p-1.5"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  {item.brandName && <p className="eyebrow">{item.brandName}</p>}
                  <Link
                    href={`/product/${item.slug}`}
                    className="rounded-sm font-medium text-ink-900 hover:text-forest-800"
                  >
                    {name}
                  </Link>
                  {!item.inStock && (
                    <p className="mt-0.5 text-xs text-ink-500">{t('product.outOfStockLine')}</p>
                  )}
                </div>

                {item.priceCents !== null && (
                  <PriceTag
                    priceCents={item.priceCents}
                    compareAtPriceCents={item.compareAtPriceCents}
                    className="shrink-0"
                  />
                )}

                <WishlistButton
                  productId={item.productId}
                  productName={name}
                  returnPath="/account/wishlist"
                  className={cn('shrink-0')}
                />
              </li>
            );
          })}
        </ul>
      </WishlistProvider>
    </div>
  );
}
