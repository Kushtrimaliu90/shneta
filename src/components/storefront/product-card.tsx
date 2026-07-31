import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { PriceTag } from '@/components/storefront/price-tag';
import { RatingStars } from '@/components/storefront/rating-stars';
import { ProductImage } from '@/components/storefront/product-image';
import type { ProductListItem } from '@/features/catalog/types';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — surface card, 1:1 image on a cream tile, brand eyebrow, 2-line name clamp,
 * rating, price row, badges top-left.
 *
 * The whole card is one link with the product name as its accessible label, rather than
 * several competing links to the same place: a keyboard user should reach a product once,
 * not four times (docs/04 §10). Add-to-cart lands in M4 as a separate control outside it.
 *
 * The eyebrow uses `ink-500`, not `ink-400` — docs/13 §C, 2.96:1 fails AA for text.
 */
export function ProductCard({
  product,
  priority = false,
  className,
}: {
  product: ProductListItem;
  priority?: boolean;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('product');
  const name = pickLocale(product.name, locale);
  const isOnSale = product.compareAtPriceCents != null;

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className="relative aspect-square bg-cream">
        <ProductImage
          path={product.imagePath}
          alt={name}
          priority={priority}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="absolute inset-0 size-full p-4"
        />

        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {isOnSale && (
            <span className="rounded-sm bg-forest-800 px-2 py-1 text-xs font-semibold text-white">
              {t('onSale')}
            </span>
          )}
          {!product.inStock && (
            <span className="rounded-sm bg-ink-900/80 px-2 py-1 text-xs font-semibold text-white">
              {t('outOfStock')}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link
          href={`/brands/${product.brandSlug}`}
          className="relative z-10 w-fit rounded-sm eyebrow hover:text-forest-700"
        >
          {product.brandName}
        </Link>

        <h3 className="line-clamp-2 text-[15px] font-medium text-ink-900">
          {/*
            Stretched link: the anchor covers the card so the whole tile is clickable, while
            the DOM keeps a single focusable link with a meaningful name.
          */}
          <Link href={`/product/${product.slug}`} className="after:absolute after:inset-0">
            {name}
          </Link>
        </h3>

        <RatingStars rating={product.ratingAvg} count={product.ratingCount} />

        <PriceTag
          priceCents={product.priceCents}
          compareAtPriceCents={product.compareAtPriceCents}
          className="mt-auto pt-1"
        />
      </div>
    </article>
  );
}
