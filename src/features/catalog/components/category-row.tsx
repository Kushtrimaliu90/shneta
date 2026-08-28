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
 * The homepage category strip.
 *
 * ── Why this is a strip and not the card shelf it used to be ──
 *
 * The shelf was six square cards, 383px tall as a section, and it sat at the **foot** of the page:
 * measured on the live site at 1920 × 937 its heading was at roughly 2560px, so reaching the
 * categories meant scrolling past a hero, four intent tiles and twelve product cards. For a
 * supplements shop that is backwards — most people arrive knowing they want vitamins, or protein,
 * and the category list is the first thing they are looking for.
 *
 * Moving it up was necessary and not sufficient, and the arithmetic is the interesting part. While
 * the hero's `min-h` resolves to `100svh − R`, the gap between the hero's bottom edge and the fold is
 *
 *     vh − 124 − (vh − R)  =  R − 124
 *
 * — a **constant**, independent of screen size (see `hero-slide.tsx`). So the room available below
 * the hero is a budget the hero hands out, not something a bigger monitor earns. At the original
 * `R = 14rem` that budget was 100px, and the trust strip spends 50 of it. Fitting a 383px card shelf
 * into what is left needs `R ≈ 35rem`, which leaves a **65px hero** on a 1366 × 768 laptop.
 *
 * So the card form could not clear the fold at any credible hero height, and the honest conclusion is
 * that the cards were the wrong shape for the job rather than in the wrong place. A category list is
 * **navigation**, and navigation should look like navigation: one scannable row, roughly 120px for the
 * whole section, which fits the budget at `R = 19rem` with the hero still 633px tall at 1920 × 937.
 *
 * ── What survived from the card shelf, because it was right ──
 *
 * Both of the ideas docs/13 §AJ landed on are kept, just smaller:
 *
 *   1. **Real product photography, not category artwork.** `categories.image_path` is null on every
 *      row and `icon` is set on exactly one, so any design leaning on category art would render its
 *      own fallback most of the time. Each pill instead shows the best-rated photographed product in
 *      that category — a promise about what is behind the click, and it updates itself as the
 *      catalogue changes. A 44px circle is enough to read a supplement tub.
 *   2. **The count.** "12 produkte" says the category has depth, and stays honest when it does not.
 *      Sorting by count means the strip leads with the deepest shelf.
 *
 * The heading is `sr-only`, following `intent-band.tsx`. A visible "Categories" title costs 56px of
 * the exact budget this section is fighting for, and six labelled category pills under a trust strip
 * do not need to be told what they are. The "all categories" link stays, as the last pill in the row,
 * where it reads as the end of the list rather than as a corner action.
 *
 * ── Why it still scrolls on a phone ──
 *
 * Six pills wrap to three rows on a 390px screen. A snapping horizontal rail shows two and a half —
 * the half is the affordance — and costs one row of height instead of three. `-mx-5 px-5` so the rail
 * bleeds to the screen edge while its first pill still lines up with everything above it.
 */
export async function CategoryRow({ tiles, locale }: { tiles: CategoryTile[]; locale: Locale }) {
  if (tiles.length === 0) return null;
  const t = await getTranslations('home');

  return (
    /*
     * Tighter above than below. This sits directly under the trust strip and has to clear the fold,
     * so its top padding is the last of the budget described above; the full rhythm returns
     * underneath, where the gap separates the strip from the bestsellers band rather than from the
     * fold.
     */
    <section aria-labelledby="categories-heading" className="pt-6 pb-9 lg:pt-7 lg:pb-11">
      <div className="container-wide">
        <h2 id="categories-heading" className="sr-only">
          {t('sections.categories')}
        </h2>

        {/*
          One row at every width, scrolling rather than wrapping.

          `flex-wrap` was the first attempt and it broke the thing this section exists for: eight
          pills plus the "all categories" pill do not fit 1584px, so that last pill dropped to a
          second row — which at 1920 x 937 put it below the fold, and made the section 179px tall
          instead of 120. A budget that depends on how long the category names happen to be is not a
          budget. Scrolling keeps the height fixed and the half-visible pill is the affordance.
        */}
        <ul className="-mx-5 no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-5 sm:mx-0 sm:px-0 lg:gap-3">
          {tiles.map((tile) => {
            /*
             * The bucket follows the flag: a curated upload lives in `brand-assets`, a borrowed
             * product photo in `product-images`. See `CategoryTile.imageIsCurated`.
             */
            const image = tile.imagePath
              ? storageUrl(tile.imageIsCurated ? 'brand-assets' : 'product-images', tile.imagePath)
              : null;

            return (
              <li key={tile.slug} className="shrink-0 snap-start">
                <Link
                  href={`/shop/${tile.slug}`}
                  className="group flex items-center gap-3 rounded-full border border-line bg-surface py-2 pr-5 pl-2 transition-all hover:-translate-y-px hover:border-forest-500 hover:shadow-md"
                >
                  <span
                    className={cn(
                      /*
                       * White behind a photograph, tinted behind nothing. Supplement packshots are
                       * cut out on white, so a tinted panel would put a hard white disc inside every
                       * pill — the photo would read as pasted on rather than sitting in the control.
                       */
                      'relative size-11 shrink-0 overflow-hidden rounded-full',
                      image ? 'bg-white ring-1 ring-line' : 'bg-forest-50',
                    )}
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        fill
                        /* A 44px disc at every breakpoint. Left to the default this would fetch a
                           640px variant six times over for the smallest images on the page. */
                        sizes="44px"
                        className="object-contain p-1 transition-transform duration-300 group-hover:scale-110"
                      />
                    ) : (
                      /* A category with products but none photographed yet — a deliberate surface
                         rather than a broken-image icon, and it disappears as photography lands. */
                      <span className="absolute inset-0 bg-gradient-to-br from-forest-100 to-lime-500/20" />
                    )}
                  </span>

                  <span className="min-w-0">
                    <span className="block text-sm font-medium whitespace-nowrap text-forest-900 group-hover:text-forest-700">
                      {pickLocale(tile.name, locale)}
                    </span>
                    <span
                      className="block font-ui text-[12px] whitespace-nowrap text-ink-500"
                      data-numeric
                    >
                      {t('sections.categoryCount', { count: tile.productCount })}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}

          {/*
            The end of the row rather than a corner link. `min-h-11` keeps the 44px target even
            though this pill has no thumbnail to set its height.
          */}
          <li className="shrink-0 snap-start">
            <Link
              href="/shop"
              className="group flex h-full min-h-[3.75rem] items-center gap-1.5 rounded-full border border-dashed border-line bg-transparent px-5 text-sm font-medium whitespace-nowrap text-forest-800 transition-colors hover:border-forest-500 hover:bg-forest-50/60"
            >
              {t('sections.allCategories')}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
