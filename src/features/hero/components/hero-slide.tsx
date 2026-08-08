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
 *   1. **The media has its own aspect ratio** (`4/5` desktop, `7/3` mobile) with `object-cover`, so
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
         */
        'min-h-[24rem] py-4 lg:min-h-[min(34rem,calc(100svh-14rem))] lg:py-10',
      )}
    >
      <div className="container-page grid w-full items-center gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
        <div>
          {eyebrow && (
            <p className={cn('eyebrow', light && 'text-lime-400')}>{eyebrow}</p>
          )}

          <Headline
            className={cn(
              'mt-3 font-display text-[2.25rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-[2.5rem] lg:text-[3.25rem]',
              light ? 'text-cream' : 'text-forest-900',
            )}
          >
            {headline}
          </Headline>

          {subhead && (
            <p
              className={cn(
                'mt-3 max-w-xl text-base text-pretty lg:mt-4 lg:text-lg',
                light ? 'text-cream/80' : 'text-ink-600',
              )}
            >
              {subhead}
            </p>
          )}

          {/* `data-hero-cta` is the marker `measure:vitals` reads to check the fold. */}
          {/*
            Side by side from the smallest width, not stacked.

            Stacking cost 116 px on a phone — two 52 px buttons plus the gap — against a usable
            height of about 742 px. Sharing one row costs 52 px and reads no worse; the labels are
            two or three words. `min-w-0` so a long Albanian label wraps inside its button rather
            than forcing the row wider than the screen.
          */}
          <div data-hero-cta className="mt-6 flex flex-row flex-wrap gap-3">
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
                  'min-w-0 flex-1 sm:flex-none',
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
                  'min-w-0 flex-1 sm:flex-none',
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
              instinct and is what makes the fold fit: 16/11 at 353 px wide is 243 px tall, 7/3 is 151.
              The 92 px saved is most of what keeps the trust strip on screen once the mobile search row
              has taken its own 54 px out of the same budget.
            */}
            <div className="relative mx-auto aspect-[7/3] w-full max-w-md overflow-hidden rounded-xl border border-line/60 lg:aspect-[4/5] lg:max-w-sm">
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
