import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { PriceTag } from '@/components/storefront/price-tag';
import { RatingStars } from '@/components/storefront/rating-stars';
import { ProductImage } from '@/components/storefront/product-image';
import { WishlistButton } from '@/features/wishlist/components/wishlist-button';
import { CompareButton } from '@/features/compare/components/compare-button';
import { QuickAdd, QuickAddLink } from '@/features/cart/components/quick-add';
import type { ProductListItem } from '@/features/catalog/types';
import { percentOff } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * docs/04 §6 — surface card, 1:1 image on a cream tile, brand eyebrow, 2-line name clamp,
 * pack spec, rating, price row.
 *
 * The whole card is one link with the product name as its accessible label, rather than
 * several competing links to the same place: a keyboard user should reach a product once,
 * not four times (docs/04 §10). Add-to-cart is the quick-add control on the tile — a separate
 * `z-10` control outside the stretched link, like the wishlist stack (see `quick-add.tsx`).
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
  const chips = [
    'vegan',
    'gluten_free',
    'lactose_free',
    'sugar_free',
    'vegetarian',
    'non_gmo',
    'halal',
  ]
    .filter((tag) => product.dietaryTags.includes(tag))
    .slice(0, 2);

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl bg-surface',
        /*
         * A hairline ring instead of a border, and a shadow that does the separating.
         *
         * `border-line` at full strength drew a visible box around every product, so a grid read as a
         * table of boxes. A 60%-opacity ring plus a barely-there resting shadow lets the card sit on the
         * cream page as an object; the weight arrives on hover, where it means something.
         */
        'shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-line/60',
        /*
         * `translate`, not `transform`.
         *
         * Tailwind v4 compiles `-translate-y-1` to the standalone `translate` property rather than to a
         * `transform` function, so naming `transform` in an arbitrary transition list animates nothing:
         * the shadow and ring eased over 300 ms while the card itself jumped its full 4 px instantly.
         * Measured on the deployed page — at +40 ms the offset was already at -4px — not read off the
         * class name, which looked right. `transition-transform` would also have worked, since v4
         * expands that shorthand to all four of transform/translate/scale/rotate; the explicit list is
         * kept because the ring colour has to be named anyway.
         */
        'transition-[translate,box-shadow,--tw-ring-color] duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-[0_16px_32px_-16px_rgb(15_42_31/0.28)] hover:ring-forest-500/40',
        /* The same treatment for a keyboard user, who previously got none of it. */
        'focus-within:-translate-y-1 focus-within:shadow-[0_16px_32px_-16px_rgb(15_42_31/0.28)] focus-within:ring-forest-500/40',
        /* Honest about motion: a lift is decoration, and some people are made ill by it. */
        'motion-reduce:transition-none motion-reduce:focus-within:translate-y-0 motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {/*
        A wash rather than a flat tile. Packshots are cut out on white, so a single flat cream behind
        them reads as two rectangles; a top-lit gradient gives the product something to sit in.
      */}
      <div className="relative aspect-square overflow-hidden bg-gradient-to-b from-white to-cream">
        <ProductImage
          path={product.imagePath}
          alt={name}
          /*
            Measured against the real grid rather than assumed from it, and it was wrong in both
            directions once the column ladder changed (docs/13 §AP).
            
            Rendered card widths on the live site: 167 at 390, 356 at 768, 225 at 1024, 254 at 1440,
            244 at 1920 and at 2560 — the container caps at 1680, so past ~1800 the card is a constant.
            The old attribute claimed 33vw from 640 up, which under-served a tablet (asked 256 for a
            356px box, so a visibly soft product photo) and claimed 25vw from 1024 up, which fetched a
            **640px variant for a 244px box** — on twenty-four cards a page.
          */
          sizes="(min-width: 1800px) 256px, (min-width: 1280px) 20vw, (min-width: 1024px) 24vw, 50vw"
          priority={priority}
          className={cn(
            'absolute inset-0 size-full p-5',
            /* The product leans in slightly. 1.04 is felt rather than seen, which is the intent. */
            'transition-transform duration-500 ease-out group-hover:scale-[1.04]',
            'motion-reduce:transition-none motion-reduce:group-hover:scale-100',
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

          forest-800 on white, which is where docs/04 §6 puts the "-20%" badge — lime is the one
          accent per viewport and it belongs to "New", not to every discounted tile in a grid.
        */}
        {product.inStock && discount !== null && (
          <span
            aria-hidden="true"
            className="absolute top-3 left-3 rounded-full bg-forest-800 px-2.5 py-1 font-ui text-[11px] font-bold tracking-wide text-white shadow-sm"
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
        {/*
          Hidden until the card is hovered or focused — but only where hovering exists.

          Two white circles sat permanently on every packshot, and in a grid of twenty-four that is
          forty-eight pieces of chrome competing with the products. `@media (hover: hover)` is doing the
          real work: a touch device has no hover state, so revealing on it would make wishlist
          unreachable. There they stay visible, which is correct rather than a compromise.
        */}
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <WishlistButton
            productId={product.id}
            productName={name}
            returnPath={`/product/${product.slug}`}
          />
          <CompareButton productId={product.id} productName={name} />
        </div>

        {/*
          docs/04 §6 — quick add, only while buyable: the out-of-stock band owns the tile's
          bottom edge otherwise, and an unavailable product must not offer an add. Exactly one
          active variant makes the add unambiguous, so the card posts the real add-to-cart
          action; several variants — or an unknown count — link to the PDP instead, because
          silently defaulting a variant is a recorded bug (docs/13), not a convenience.
        */}
        {product.inStock &&
          (product.variantCount === 1 ? (
            <QuickAdd variantId={product.variantId} productName={name} />
          ) : (
            <QuickAddLink slug={product.slug} productName={name} />
          ))}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        {/*
          Brand and rating share a row instead of costing two.

          `truncate` fixes a live defect: at 11 px uppercase with 0.08em tracking roughly thirteen
          characters fit the body box, so SCITEC NUTRITION, OPTIMUM NUTRITION and NORDIC NATURALS each
          wrapped to two lines on every mobile card.
        */}
        <div className="flex min-h-5 items-center justify-between gap-2">
          <Link
            href={`/brands/${product.brandSlug}`}
            className="relative z-10 min-w-0 truncate rounded-sm font-ui text-[10px] font-semibold tracking-[0.1em] text-ink-500 uppercase transition-colors hover:text-forest-700"
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

        {/*
          The name is the card's headline, so it gets the weight the brand used to hold. forest-950
          rather than ink-900: on cream it reads warmer and ties the grid to the palette.
        */}
        <h3 className="line-clamp-2 text-[15.5px] leading-[1.3] font-semibold text-forest-950">
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
                    /* Tinted rather than outlined: an outline gives a chip the same weight as a button. */
                    'shrink-0 rounded-full bg-forest-50 px-2 py-0.5 font-ui text-[10.5px] font-semibold tracking-wide text-forest-800',
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
