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
 * ── The vertical rhythm fix ──
 *
 * The old hero put a **667 × 898 portrait** photograph in a two-column grid at `max-w-md`. At 448 px
 * wide that image is 603 px tall, so it — not the copy — set the row height, and `items-center`
 * then parked the text against the middle of it. Measured on the live site: the `h1`'s bottom edge
 * sat at **462 px of a 900 px viewport**, which is the "headline starts halfway down" complaint,
 * stated in pixels.
 *
 * Three changes fix it and none of them is a magic number:
 *
 *   1. **The media has its own aspect ratio** (`4/5` desktop, `16/9` mobile) with `object-cover`, so
 *      the image fills a box the layout chose instead of dictating one. A future slide with a
 *      different source file cannot reintroduce the problem. The phone gets the *wider* crop, which
 *      is the opposite of the usual instinct and is what buys the trust strip its place on screen.
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

  return (
    <section
      className={cn(
        'flex items-center',
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
        'min-h-[24rem] py-3 sm:py-4 lg:min-h-[min(34rem,calc(100svh-14rem))] lg:py-10',
      )}
    >
      <div className="container-page grid w-full items-center gap-4 sm:gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div>
          {eyebrow && (
            <p className={cn('eyebrow', light && 'text-lime-400')}>{eyebrow}</p>
          )}

          <Headline
            className={cn(
              'mt-2 sm:mt-3 font-display text-[2.25rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-[2.5rem] lg:text-[3.25rem]',
              light ? 'text-cream' : 'text-forest-900',
            )}
          >
            {headline}
          </Headline>

          {subhead && (
            <p
              className={cn(
                'mt-2 max-w-xl text-base text-pretty sm:mt-3 lg:mt-4 lg:text-lg',
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

        {desktopSrc && (
          <div className="order-first lg:order-none">
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
            <div className="relative mx-auto aspect-[16/9] w-full max-w-md overflow-hidden rounded-xl border border-line/60 lg:aspect-[4/5] lg:max-w-sm">
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
                    sizes="24rem"
                    priority={priority}
                    loading={priority ? undefined : 'lazy'}
                    className="hidden object-cover lg:block"
                  />
                </>
              ) : (
                /*
                 * `contain` on the phone when there is no dedicated mobile crop, `cover` on desktop.
                 *
                 * A 7:3 cover crop of a portrait product photograph slices the tops and bottoms off
                 * the tubs — reported from a phone, and it looks careless rather than tight. The
                 * desktop box is 4:5 and close enough to the source that cover is right there.
                 *
                 * This applies only to the fallback path. When an admin has supplied a **mobile
                 * creative** it was composed for 7:3 and gets `cover` in the branch above, which is
                 * the better answer and the reason that slot exists.
                 */
                <Image
                  src={desktopSrc}
                  alt={desktopAlt}
                  fill
                  sizes="(min-width: 1024px) 24rem, 100vw"
                  priority={priority}
                  loading={priority ? undefined : 'lazy'}
                  className="object-cover"
                />
              )}
            </div>
          </div>
        )}
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
