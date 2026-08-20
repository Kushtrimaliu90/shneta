import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { buttonVariants } from '@/components/ui/button';
import { storageUrl } from '@/lib/storage';
import type { HeroSlide } from '@/features/hero/types';
import { cn } from '@/lib/utils';

/**
 * One hero slide.
 *
 * ── The full-bleed split (desktop) ──
 *
 * The hero used to be a 1240px two-column grid inside a full-width coloured band, with the
 * photograph capped at `lg:max-w-sm`. Measured on the live site at 2560 × 1400 before this change:
 * the band was **2560 × 560 of `forest-950`**, the photograph inside it was **384px wide**, and so
 * the brand's single most important image occupied about **2.6% of the area it sat in** while
 * roughly 1160px of that band was empty paint. docs/04 §3 says photography does the selling; the
 * layout was not letting it.
 *
 * Now, from `lg` up, the media is absolutely positioned into the **right half of the viewport** —
 * edge to edge, top to bottom, `object-cover`, no card, no radius, no `max-w`. The copy sits in
 * `container-wide`'s first column on the left.
 *
 * **The join is exact, and it is arithmetic rather than a magic number.** `container-wide` is
 * `max-width: W` with `margin-inline: auto` and `padding-inline: g`, so for a body of width `B` its
 * first column of two ends at `(B − W)/2 + g + (W − 2g)/2`, which reduces to `B/2` — precisely where
 * an `absolute right-0 w-1/2` panel begins. The two edges therefore meet at every viewport width
 * without either side knowing the other's numbers. This is also why `--gutter-wide` is expressed in
 * `%` and not `vw`: `vw` includes the classic scrollbar, `B` does not, and a few pixels of drift
 * would show as a seam.
 *
 * The gradient over the media's leading edge is not decoration — it is what keeps that seam from
 * reading as a hard cut when a photograph's left edge happens to be light against `forest-950`.
 *
 * ── The vertical rhythm fix (kept) ──
 *
 * The old hero put a **667 × 898 portrait** photograph in a two-column grid at `max-w-md`. At 448 px
 * wide that image is 603 px tall, so it — not the copy — set the row height, and `items-center`
 * then parked the text against the middle of it. Measured on the live site: the `h1`'s bottom edge
 * sat at **462 px of a 900 px viewport**, which is the "headline starts halfway down" complaint,
 * stated in pixels.
 *
 * Three changes fixed it and none of them is a magic number:
 *
 *   1. **The media has its own aspect ratio** (`16/9` mobile; on desktop it now fills the panel the
 *      layout gave it) with `object-cover`, so the image fills a box the layout chose instead of
 *      dictating one. A future slide with a different source file cannot reintroduce the problem.
 *      The phone gets the *wider* crop, which is the opposite of the usual instinct and is what buys
 *      the trust strip its place on screen.
 *   2. **The section is `min-h`, not padding-driven.** Content is centred inside a box sized to leave
 *      room for the trust strip under it.
 *   3. **Top padding is small.** The sticky header already separates the hero from the top of the
 *      window; `section-y` was adding a second gap on top of it.
 *
 * ── `text_variant` is a legibility control ──
 *
 * `dark` is the editorial default: dark type on cream, which is what the brand slide uses. `light`
 * flips the slide to forest-950 with cream type, for a promo whose photograph is dark. It is not a
 * theme toggle — the admin picks whichever reads against the image they chose.
 */
export function HeroSlideView({
  slide,
  locale,
  active,
  isHeading,
  priority,
}: {
  slide: HeroSlide;
  locale: Locale;
  active: boolean;
  /** Only one slide's headline may be the `<h1>`. */
  isHeading: boolean;
  priority: boolean;
}) {
  const light = slide.textVariant === 'light';

  const eyebrow = pickLocale(slide.eyebrow, locale);
  const headline = pickLocale(slide.headline, locale);
  const subhead = pickLocale(slide.subhead, locale);
  const primaryLabel = pickLocale(slide.ctaPrimaryLabel, locale);
  const secondaryLabel = pickLocale(slide.ctaSecondaryLabel, locale);

  const desktopSrc = resolveImage(slide.imageDesktopPath);
  // Falls back to the desktop crop, which is why the second slot can stay empty.
  const mobileSrc = resolveImage(slide.imageMobilePath) ?? desktopSrc;
  const desktopAlt = pickLocale(slide.imageDesktopAlt, locale);
  const mobileAlt = pickLocale(slide.imageMobileAlt, locale) || desktopAlt;

  const Headline = isHeading ? 'h1' : 'p';

  /*
   * The media is 50vw from `lg` up, and the full width below it. Getting this wrong is invisible
   * locally and expensive in production — it is what decides which srcset candidate every visitor
   * downloads for the LCP element.
   */
  const desktopSizes = '(min-width: 1024px) 50vw, 100vw';

  return (
    <section
      className={cn(
        /*
         * `relative` establishes the containing block the media panel is positioned into, and
         * `overflow-hidden` is what guarantees a `w-1/2` panel cannot contribute horizontal scroll
         * on a sub-pixel viewport width.
         *
         * `flex-col justify-center` rather than the old `items-center`: the media is a sibling of
         * the copy container now (so that DOM order still puts the image first on a phone, where it
         * is in flow), and on mobile the two need to stack and centre as a group.
         */
        'relative flex flex-col justify-center overflow-hidden',
        light ? 'bg-forest-950' : 'bg-cream',
        /*
         * Sized to leave the trust strip room inside the first viewport. `svh` rather than `vh` so a
         * mobile browser's collapsing address bar does not push the CTAs off-screen.
         *
         * The mobile padding is deliberately mean. Measured on production at 393 × 852: with `py-8`
         * and a 16/11 image the strip landed at 873–999, i.e. **below the fold on the exact device
         * the brief names**. Desktop was never the problem; the phone is where 742 px of usable
         * height has to hold an image, four blocks of copy, two buttons and the strip.
         *
         * `py-3` under `sm` rather than `py-4`, and the same one-step trim on every gap below, pays for
         * the two mobile fixes above. Stacking the CTAs cost 14 px and moving the dots into flow cost
         * 24 px; production had **17 px** of headroom at 390 × 844, so without repaying it the trust
         * strip drops off the first viewport — the exact regression this file's own E2E assertion
         * exists to catch, and it did catch it. Each step restores at `sm`, so tablet and desktop are
         * untouched.
         */
        /*
         * `pt-2` rather than `pt-3` funds the dots' new bottom margin. The sticky header already
         * separates the hero from the top of the window, so the top gap is the cheapest 4 px on the
         * page — and it buys the one place that needed it, between the dots and the trust strip.
         */
        /*
         * The desktop cap goes 34rem → 48.75rem (780px) so a 1080p or taller screen gets a hero that
         * fills the fold on purpose rather than a 560px band floating in it.
         *
         * **The `calc(100svh - R)` term is the important half**, and `R` is now 17rem rather than 14.
         * That term reserves room for what follows the hero inside the first viewport, and the
         * arithmetic is worth stating because it is counter-intuitive: whenever `100svh - R` is the
         * smaller side of the `min()`, the space between the hero's bottom edge and the fold is
         *
         *     vh − 124 − (vh − R)  =  R − 124
         *
         * — **a constant**, independent of screen size (124px = the 44px announcement bar plus the
         * 80px header). The room below the hero is therefore a budget the hero hands out, not
         * something a larger monitor earns.
         *
         * At `R = 14rem` that budget was 100px and the 50px trust strip spent half of it, which is
         * why the category strip landed below the fold on *every* desktop viewport rather than on
         * short ones only. `R = 19rem` gives 180px: 50 for the trust strip and 130 for a ~120px
         * category strip, which clears the fold from 1366 × 625 upward.
         *
         * The old 383px category *cards* would have needed `R ≈ 35rem` — a 65px hero on a 1366 × 768
         * laptop — which is why they became a strip instead (see `category-row.tsx`). The cost here
         * is 80px of hero height on viewports shorter than about 1100px, and nothing at all at 2560,
         * where the 48.75rem cap governs instead.
         *
         * **`py-10`, not `py-16`, and this is the one exception to the arithmetic above.** The
         * reservation only governs while `min-h` is what decides the height. On a 1366 x 625 viewport
         * the hero's *content* is taller than `100svh - 19rem`, so the hero is content-bound at 390px
         * and raising `R` buys nothing there — a box does not shrink below what is inside it. Vertical
         * padding is the only lever left, and it is free everywhere else: from 1920 up the hero is
         * min-height-bound, so the 48px this returns changes nothing on those screens and is exactly
         * what lets the category pills clear the fold on a laptop.
         *
         * `e2e/hero.spec.ts` still holds: the reservation only grew, so the trust strip has more
         * room inside the first viewport, not less.
         */
        'min-h-[24rem] pt-2 pb-3 sm:py-4 lg:min-h-[min(48.75rem,calc(100svh-19rem))] lg:py-10 short:lg:py-6',
      )}
    >
      {desktopSrc && (
        /*
         * In flow above the copy on a phone; the right half of the viewport from `lg` up.
         *
         * DOM order does the mobile ordering that `order-first` used to, now that this is a sibling
         * of the copy container rather than a second grid cell.
         *
         * **`px-5 md:px-6` replaces the padding this element lost when it left `container-page`.**
         * Without it the phone image goes edge-to-edge, which looks fine and costs 22 px of height
         * (350 px wide at 16/9 is 197 px tall; 390 px wide is 219). Measured at 390 × 844 that took
         * the trust strip's headroom inside the first viewport from **17 px to 2 px** — still passing
         * `e2e/hero.spec.ts`, and one long Albanian string away from not. The fold budget on this page
         * is documented to the pixel below; a nicer mobile bleed is not worth spending it.
         */
        <div className="px-5 md:px-6 lg:absolute lg:inset-y-0 lg:right-0 lg:z-0 lg:w-1/2 lg:px-0">
          {/*
            The box owns the aspect ratio; the image fills it. That is what stops a portrait source
            from setting the row height, and it reserves the space before the file resolves — the
            baseline was CLS 0.0000 and this keeps it there.
          */}
          {/*
            A wider crop on the phone than on the desktop, which is the opposite of the usual
            instinct and is what makes the fold fit: the original 16/11 was 243 px tall at 353 px
            wide, and 16/9 is 198.

            It went to 7/3 (151 px) first, which fit beautifully and sliced the tops off the product
            tubs — reported from a phone, and it looked careless rather than tight. `object-contain`
            was the next attempt and was worse: a portrait source contained in a 7/3 box is a
            postage stamp floating in empty margins. 16/9 with `cover` is the compromise that keeps
            the subject intact and still leaves the trust strip 138 px of room.

            The real answer for this slide is a **mobile creative** composed for the ratio; the slot
            exists and is empty. When one is supplied it gets `cover` in the branch above, and none
            of this applies.
          */}
          {/*
            Every mobile class here is deliberately untouched — the phone fold is measured to 17 px
            of headroom and is asserted in `e2e/hero.spec.ts`. The desktop half drops the card
            entirely: a full-bleed panel with a radius and a hairline border would be a card
            pretending to be a bleed.
          */}
          <div
            className={cn(
              'relative mx-auto aspect-[16/9] w-full max-w-md overflow-hidden rounded-xl border border-line/60',
              'lg:aspect-auto lg:h-full lg:max-w-none lg:rounded-none lg:border-0',
            )}
          >
            {/*
              One element when both breakpoints use the same file, two only when the admin has
              actually supplied a separate mobile crop.

              The first version rendered both unconditionally and let CSS hide one. It measured
              **CLS 0.0002** against a baseline of exactly 0.0000 — negligible in absolute terms, and
              still a regression against a number that was perfect. Two `fill` children in one
              relative box are two subscribers to the same layout, and the `display:none` one is
              resolved a frame later than the box that contains it.
            */}
            {mobileSrc && mobileSrc !== desktopSrc ? (
              <>
                <Image
                  src={mobileSrc}
                  alt={mobileAlt}
                  fill
                  sizes="100vw"
                  priority={priority}
                  /* Slides 2+ sit behind the active one, so they wait. */
                  loading={priority ? undefined : 'lazy'}
                  className="object-cover lg:hidden"
                />
                <Image
                  src={desktopSrc}
                  alt={desktopAlt}
                  fill
                  sizes="50vw"
                  priority={priority}
                  loading={priority ? undefined : 'lazy'}
                  className="hidden object-cover lg:block"
                />
              </>
            ) : (
              /*
               * One file for both breakpoints, `cover` at each. The desktop panel is now a
               * viewport-height half-screen rather than a 4:5 card, which suits a portrait product
               * photograph better than the card ever did.
               *
               * This applies only to the fallback path. When an admin has supplied a **mobile
               * creative** it was composed for the phone ratio and gets `cover` in the branch above,
               * which is the better answer and the reason that slot exists.
               */
              <Image
                src={desktopSrc}
                alt={desktopAlt}
                fill
                sizes={desktopSizes}
                priority={priority}
                loading={priority ? undefined : 'lazy'}
                className="object-cover"
              />
            )}

            {/*
              The seam softener, desktop only.

              The copy half and the media half meet on an exact pixel boundary (see the join
              arithmetic in this file's header). Whether that boundary *reads* as a seam depends
              entirely on the photograph: a light left edge against `forest-950` is a hard cut. A
              short gradient in the ground colour over the media's leading edge removes the cut
              without dimming the image where the subject actually is.

              `aria-hidden` and no text: it is a legibility device, not content.
            */}
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 left-0 hidden w-[18%] lg:block',
                light
                  ? 'bg-gradient-to-r from-forest-950 to-transparent'
                  : 'bg-gradient-to-r from-cream to-transparent',
              )}
            />
          </div>
        </div>
      )}

      {/*
        `container-wide`, not `container-page`: the copy column has to line up with the navbar's
        left edge, and the navbar moved to the wide tier in the same change. Two columns at `lg`
        with the copy in the first — the empty second column is what the media panel overlays, and
        what makes the join exact.
      */}
      <div className="relative z-10 container-wide grid w-full items-center gap-4 sm:gap-6 lg:grid-cols-2 lg:gap-12">
        {/*
          `lg:pb-20` is clearance for the carousel's control cluster, which is absolutely positioned
          at the foot of this column.

          It is not cosmetic spacing. Trimming the hero's padding to `py-10` made the hero
          content-bound on a 1366 x 625 viewport, and a content-bound box ends exactly where its
          content ends — so the cluster landed **on top of the primary CTA**, which is docs/13 §N8
          repeating itself with different elements. Two things pinned to the same edge always end
          that way, and z-index would only decide which one won the click.

          80px against a cluster that occupies 24-68px from the bottom edge. Padding rather than a
          margin so it counts toward this column's height, which is what makes the hero grow to hold
          both instead of stacking them. Free on any viewport where `min-h` governs.
        */}
        <div className="lg:pb-20 short:lg:pb-12">
          {eyebrow && <p className={cn('eyebrow', light && 'text-lime-400')}>{eyebrow}</p>}

          <Headline
            className={cn(
              'mt-2 font-display leading-[1.05] font-semibold tracking-tight text-balance sm:mt-3',
              /*
               * Fluid from `lg` up. It was a fixed 52px, which is the same headline on a 14-inch
               * laptop and on a 27-inch monitor — measured identical at 1440 and at 2560, and it
               * reads timid on the larger one.
               *
               * **The floor is today's 52px, not the 48px the viewport maths wants.** The first
               * version used a `3rem` floor and measured 48px at 1024 through 1440 — fluid type that
               * makes the headline *smaller* on most laptops is not an improvement, it is a
               * regression with a nicer implementation. So the clamp only ever adds: 52px up to
               * ~1530, then 65px at 1920, topping out at 72px. The ceiling exists because a headline
               * still has to wrap somewhere sensible inside its column.
               */
              'text-[2.25rem] sm:text-[2.5rem] lg:text-[clamp(3.25rem,3.4vw,4.5rem)]',
              light ? 'text-cream' : 'text-forest-900',
            )}
          >
            {headline}
          </Headline>

          {subhead && (
            <p
              className={cn(
                'mt-2 max-w-xl text-base text-pretty sm:mt-3 lg:mt-4 lg:max-w-2xl lg:text-lg 2xl:text-xl',
                light ? 'text-cream/80' : 'text-ink-600',
              )}
            >
              {subhead}
            </p>
          )}

          {/* `data-hero-cta` is the marker `measure:vitals` reads to check the fold. */}
          {/*
            Stacked and full width on a phone; side by side, auto width, from `sm` up.

            They shared a row on mobile first, to save height. It cost less than stacking and looked
            worse: at 390 px each button got about 168 px, which is not enough for "Krijo Protokollin
            BioHack" — it broke onto three lines, and the two buttons then differed in width by the
            two pixels the flex gap could not divide evenly. A label that wraps to three lines inside
            a 168 px box is the signal that the row is the wrong container, not that the label is too
            long.

            Full width gives it one line and makes both buttons identical by construction rather than
            by arithmetic. It costs about 16 px against the fold budget, which the measurement said
            was there.
          */}
          <div data-hero-cta className="mt-4 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:flex-wrap">
            {slide.ctaPrimaryHref && primaryLabel && (
              <Link
                href={slide.ctaPrimaryHref}
                /*
                 * `tabIndex={-1}` on an inactive slide belts the `inert` braces in the carousel.
                 * `inert` is well supported now but is still newer than this project's browser floor,
                 * and a CTA a keyboard user can reach but not see is a bad enough failure to guard
                 * twice.
                 */
                tabIndex={active ? undefined : -1}
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'h-auto w-full min-w-0 py-3 text-center leading-snug whitespace-normal sm:w-auto sm:flex-none',
                  light && 'bg-lime-500 text-lime-950 hover:bg-lime-400',
                )}
              >
                {primaryLabel}
              </Link>
            )}
            {slide.ctaSecondaryHref && secondaryLabel && (
              <Link
                href={slide.ctaSecondaryHref}
                tabIndex={active ? undefined : -1}
                className={cn(
                  buttonVariants({ variant: 'secondary', size: 'lg' }),
                  'h-auto w-full min-w-0 py-3 text-center leading-snug whitespace-normal sm:w-auto sm:flex-none',
                  light && 'border-cream/30 bg-transparent text-cream hover:bg-cream/10',
                )}
              >
                {secondaryLabel}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A slide image is either a public asset or a storage object, and the leading slash says which.
 *
 * The brand slide's photograph ships in `public/hero/` and was already optimised down to a 122 kB
 * WebP; re-uploading it into the bucket to make the code uniform would have changed the file the
 * performance baseline was measured against for no benefit. Everything uploaded from the admin panel
 * lands in the `content` bucket and comes through `storageUrl`.
 */
function resolveImage(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? path : storageUrl('content', path);
}
