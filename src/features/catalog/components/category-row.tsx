import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import { storageUrl } from '@/lib/storage';
import { cn } from '@/lib/utils';
import type { Locale } from '@/lib/constants';
import type { CategoryTile } from '@/features/catalog/queries';

/**
 * The homepage category row.
 *
 * ── What it replaced, and why that was the wrong design ──
 *
 * Six pale rectangles with a name in each. Interchangeable, and silent about everything a shopper wants
 * before clicking: what is in there, how much of it, what it looks like. One of the six — "BioGear" —
 * had zero published products, so a tile that looked like a destination was a dead end.
 *
 * ── Designed against the assets that exist, not the ones a mockup would want ──
 *
 * Checked first: `categories.image_path` is null on every row and `icon` is set on exactly one. Any
 * design leaning on category artwork would have rendered *worse* than the rectangles, because the
 * fallback would be most of the row. What does exist is product photography — 45 of 63 published
 * products carry one — so each tile shows the best-rated photographed product in that category.
 *
 * That is the stronger idea anyway. A category picture is a stock photo of an abstraction; a real
 * product from the shelf is a promise about what is behind the click, and it updates itself as the
 * catalogue changes.
 *
 * ── The count is the second half ──
 *
 * "8 products" does the work a picture cannot: it says the category has depth, and it is honest when it
 * does not. Sorting by count means the row leads with the deepest shelf rather than with whatever
 * `sort_order` happened to say.
 *
 * ── Why it scrolls on a phone ──
 *
 * Six tiles in a two-column grid is three rows of scrolling before the footer. A snapping horizontal
 * rail shows two and a half — the half is the affordance, and it costs one row of height instead of
 * three. The grid returns at `sm`, where the width is there to use.
 */
export async function CategoryRow({
  tiles,
  locale,
}: {
  tiles: CategoryTile[];
  locale: Locale;
}) {
  if (tiles.length === 0) return null;
  const t = await getTranslations('home');

  return (
    <section aria-labelledby="categories-heading" className="py-12 lg:py-16">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="categories-heading"
            className="font-display text-2xl font-semibold text-forest-900 lg:text-3xl"
          >
            {t('sections.categories')}
          </h2>
          <Link
            href="/shop"
            className="group inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800"
          >
            {t('sections.allCategories')}
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        </div>

        {/*
          `-mx-5 px-5` so the rail bleeds to the screen edge on a phone while its first tile still lines
          up with the heading. Without it the row starts inset and reads as a boxed widget rather than a
          shelf that continues off-screen.
        */}
        <ul className="mt-6 -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6 lg:gap-4">
          {tiles.map((tile) => {
            const image = tile.imagePath ? storageUrl('product-images', tile.imagePath) : null;

            return (
              <li key={tile.slug} className="w-40 shrink-0 snap-start sm:w-auto">
                <Link
                  href={`/shop/${tile.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-all hover:-translate-y-0.5 hover:border-forest-500 hover:shadow-md"
                >
                  <div className={cn(
                    'relative aspect-square overflow-hidden',
                    /*
                     * White behind a photograph, tinted behind nothing.
                     *
                     * Supplement packshots are cut out on white, so a tinted panel put a hard white square
                     * inside every tile — the photo read as pasted on rather than sitting in the card. The
                     * tint is worth keeping for the empty case, where it is a deliberate surface rather
                     * than an accident.
                     */
                    image ? 'bg-white' : 'bg-forest-50',
                  )}>
                    {image ? (
                      <Image
                        src={image}
                        alt={pickLocale(tile.imageAlt, locale)}
                        fill
                        /*
                          Small on every breakpoint — a 160 px rail tile on a phone, a sixth of the
                          container at `lg`. Left to the default this would request a 640 px variant for
                          a 180 px box, six times over.
                        */
                        sizes="(min-width: 1024px) 12rem, (min-width: 640px) 20vw, 10rem"
                        className="object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      /*
                        A category with products but none photographed yet. A tinted panel rather than a
                        broken-image icon or a grey box: it reads as a deliberate surface, and it
                        disappears on its own as the photography lands.
                      */
                      <div className="absolute inset-0 bg-gradient-to-br from-forest-50 to-lime-500/10" />
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between gap-1 border-t border-line/60 p-3">
                    <span className="text-sm font-medium text-forest-900 group-hover:text-forest-700">
                      {pickLocale(tile.name, locale)}
                    </span>
                    <span className="font-ui text-[12px] text-ink-500" data-numeric>
                      {t('sections.categoryCount', { count: tile.productCount })}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
