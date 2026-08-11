import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { PriceTag } from '@/components/storefront/price-tag';
import { RatingStars } from '@/components/storefront/rating-stars';
import { ProductImage } from '@/components/storefront/product-image';
import { WishlistButton } from '@/features/wishlist/components/wishlist-button';
import { CompareButton } from '@/features/compare/components/compare-button';
import type { ProductListItem } from '@/features/catalog/types';
import { percentOff } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — surface card, 1:1 image on a cream tile, brand eyebrow, 2-line name clamp,
 * pack spec, rating, price row.
 *
 * The whole card is one link with the product name as its accessible label, rather than
 * several competing links to the same place: a keyboard user should reach a product once,
 * not four times (docs/04 §10). Add-to-cart lands in M4 as a separate control outside it.
 *
 * ── The redesign, and what it is built on ──
 *
 * Designed against what this catalogue actually holds rather than what a card usually shows. Two facts
 * decided it: **no product has a review yet**, so a rating-led card repeated "not rated yet" down the
 * whole grid; and **every one of the 64 published products has a `subtitle`** that was fetched, mapped,
 * bilingual — and rendered nowhere.
 *
 * Those subtitles are pack specs: "30 kapsula, formulë e përditshme", "908 g, kazeinë micelare",
 * "200 kapsula, raport 2:1:1". Putting that line on the card is the largest change here, because it
 * turns three identical-looking magnesium products into a comparison a shopper can finish in the grid
 * rather than by opening three tabs. Nothing had to be queried to get it.
 *
 * ── What came off ──
 *
 * The top-left "Ofertë" badge, replaced by the number. A word said less in more space, and could sit on
 * a product that was out of stock; `−20%` says the same thing quantitatively and only while buyable.
 *
 * And the reserved `min-h-[3rem]` on the price. It existed so prices lined up across a row when one
 * card wrapped to two lines: the right goal reached from the wrong end, costing ~24 px of dead space on
 * every card. Pinning the whole buy block with one `mt-auto` was most of the answer; the rest was moving
 * the discount badge off the price line, since as a third item it wrapped below at card width and put a
 * discounted price at a different height from its neighbour — measured on the rendered grid, not guessed.
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
  const ts = useTranslations('shop');
  const name = pickLocale(product.name, locale);
  const subtitle = pickLocale(product.subtitle, locale);
  const discount = percentOff(product.priceCents, product.compareAtPriceCents);

  /*
   * Two chips at most, and the second only from `sm` up.
   *
   * At 2-up on a 360 px phone the body box is about 120 px; three chips wrap to a second row and push
   * the price down. Ordered by what a supplement buyer actually filters on rather than by whatever
   * order the array happens to hold — avoiding gluten is a harder constraint than preferring non-GMO.
   */
  const chips = ['vegan', 'gluten_free', 'lactose_free', 'sugar_free', 'vegetarian', 'non_gmo', 'halal']
    .filter((tag) => product.dietaryTags.includes(tag))
    .slice(0, 2);

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-shadow hover:shadow-md',
        /* The card had a hover state and no keyboard equivalent; the stretched link focuses inside it. */
        'focus-within:shadow-md',
        className,
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-cream">
        <ProductImage
          path={product.imagePath}
          alt={name}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          priority={priority}
          className={cn(
            'absolute inset-0 size-full p-4',
            /*
             * Greyed rather than hidden. `grayscale` reaches the placeholder ring too, which a plain
             * opacity drop does not — so the products still without a photograph read as unavailable in
             * the same visual language as the ones that have one. Reinforcement only: the band below
             * carries the word.
             */
            !product.inStock && 'opacity-60 grayscale',
          )}
        />

        {/*
          The discount, on the tile rather than beside the price.

          Inline it was a third item on the price line and wrapped below at card width, which put a
          discounted product's price at a different height from its neighbour — the exact misalignment
          the old reserved min-height was hiding. Here it costs no layout, and a shopper scanning a grid
          sees it without reading. Only while in stock: an unavailable product must not advertise a deal.

          aria-hidden because PriceTag still renders the struck-through original with its screen-reader
          'was' prefix, so the saving is already announced once.
        */}
        {product.inStock && discount !== null && (
          <span
            aria-hidden="true"
            className="absolute top-3 left-3 rounded-sm bg-forest-800 px-2 py-1 text-xs font-semibold text-white"
          >
            −{discount}%
          </span>
        )}

        {/*
          A full-bleed band rather than a corner pill.

          At 2-up the two stacked action buttons already own about 76 px of the tile's right edge, and a
          badge stack in the opposite corner crowds a 152 px square. A band cannot crowd anything, reads
          at a glance, and survives greyscale and forced-colours because it is text.
        */}
        {!product.inStock && (
          <p className="absolute inset-x-0 bottom-0 bg-ink-900/85 py-1.5 text-center font-ui text-[11px] font-semibold tracking-[0.06em] text-white uppercase">
            {t('outOfStock')}
          </p>
        )}

        {/*
          `z-10` keeps these above the name link's `::after`, which covers the whole card. Without it
          the heart is unclickable — the overlay is invisible and takes every pointer event.
        */}
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
          <WishlistButton
            productId={product.id}
            productName={name}
            returnPath={`/product/${product.slug}`}
          />
          <CompareButton productId={product.id} productName={name} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {/*
          Brand and rating share a row instead of costing two.

          `truncate` fixes a live defect: at 11 px uppercase with 0.08em tracking roughly thirteen
          characters fit the body box, so SCITEC NUTRITION, OPTIMUM NUTRITION and NORDIC NATURALS each
          wrapped to two lines on every mobile card.
        */}
        <div className="flex min-h-5 items-center justify-between gap-2">
          <Link
            href={`/brands/${product.brandSlug}`}
            className="relative z-10 min-w-0 truncate rounded-sm font-ui text-[11px] font-semibold tracking-[0.08em] text-forest-800 uppercase transition-colors hover:text-forest-600"
          >
            {product.brandName}
          </Link>

          {/*
            Only when a rating exists. Nothing in the catalogue has one yet, so `RatingStars` was
            rendering "not rated yet" on all 64 cards — a row of identical absence reads as a defect,
            and it is the reason this card leads with facts instead of stars.
          */}
          {product.ratingCount > 0 && (
            <RatingStars
              rating={product.ratingAvg}
              count={product.ratingCount}
              className="shrink-0"
            />
          )}
        </div>

        <h3 className="line-clamp-2 text-[15px] leading-snug font-medium text-ink-900">
          {/*
            One link, stretched over the card by `::after`. The name is the accessible label, which is
            why the brand above and the two buttons are the only other tab stops here.
          */}
          <Link href={`/product/${product.slug}`} className="after:absolute after:inset-0">
            {name}
          </Link>
        </h3>

        {/*
          The pack spec. Already on `ProductListItem`, already fetched, previously shown nowhere.

          `min-h` rather than a conditional, so a product without one leaves the same gap and the prices
          below still line up. One line, clamped: these run 20–30 characters and the count leads.
        */}
        <p className="line-clamp-1 min-h-[1.25rem] text-[13px] leading-snug text-ink-600">
          {subtitle}
        </p>

        {/*
          Chips and price pinned together as one block, so the price sits at the same height across a
          row whether or not its neighbour has chips or a two-line name.
        */}
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {chips.length > 0 && (
            <div className="flex items-center gap-1">
              {chips.map((tag, index) => (
                <span
                  key={tag}
                  className={cn(
                    'shrink-0 rounded-sm border border-line-strong bg-cream px-1.5 py-0.5 font-ui text-[11px] font-semibold text-ink-600',
                    /* The second chip only where there is room for it. */
                    index === 1 && 'hidden sm:inline-block',
                  )}
                >
                  {ts(`tags.${tag}` as 'tags.vegan')}
                </span>
              ))}
            </div>
          )}

          <PriceTag
            priceCents={product.priceCents}
            compareAtPriceCents={product.compareAtPriceCents}
            showDiscountBadge={false}
          />
        </div>
      </div>
    </article>
  );
}
