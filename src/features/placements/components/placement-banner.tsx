'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { pickLocale } from '@/lib/i18n';
import { storageUrl } from '@/lib/storage';
import type { Locale } from '@/lib/constants';
import type { Placement } from '@/features/placements/queries';
import { recordAdClick, recordAdImpression } from '@/features/placements/actions';
import { Carousel } from '@/components/shared/carousel';

/**
 * The sponsored placement slot on the listing pages.
 *
 * ── Disclosure the creative cannot defeat ──
 *
 * The "Sponsored" label is a sibling of the image, not part of it, and it sits on an opaque chip
 * rather than over the artwork — so an advertiser cannot supply a busy or pale creative and have the
 * label disappear into it. `isPaid` is a column with no admin control to unset it, so a paid
 * placement cannot be published without the label. BioCode's own promotions set it false and carry no
 * label, because calling them sponsored would be its own kind of lie.
 *
 * It is also deliberately not shaped like a product card: full width, wide aspect, its own border and
 * background. A shopper should be able to tell at a glance that this is an advertisement and not the
 * first item of the grid.
 *
 * ── Zero CLS ──
 *
 * The aspect ratio is on the box and the image fills it, so the height is settled before any request
 * finishes. 5:1 on desktop and 2:1 on mobile, from the brief, which is also what keeps the first row
 * of products visible at 1440 × 900.
 */
export function PlacementBanner({ placements }: { placements: Placement[] }) {
  const t = useTranslations('placements');
  const locale = useLocale() as Locale;

  if (placements.length === 0) return null;

  return (
    <div className="mb-6 lg:mb-8">
      <Carousel
        items={placements}
        autoplay
        intervalSeconds={7}
        /*
         * No arrows. The slot is 5:1, so a 44 px control centred vertically would sit across the
         * creative an advertiser paid for. Dots, swipe and the keyboard are the controls here.
         */
        arrows={false}
        labels={{
          region: t('regionLabel'),
          slide: t('slideLabel', { index: '{index}', total: '{total}' }),
          goTo: t('goToSlide', { index: '{index}', total: '{total}' }),
          previous: t('previous'),
          next: t('next'),
          choose: t('choose'),
        }}
        renderItem={(placement, { active, index }) => (
          <PlacementSlide
            placement={placement}
            locale={locale}
            active={active}
            priority={index === 0}
          />
        )}
      />
    </div>
  );
}

function PlacementSlide({
  placement,
  locale,
  active,
  priority,
}: {
  placement: Placement;
  locale: Locale;
  active: boolean;
  priority: boolean;
}) {
  const t = useTranslations('placements');
  const ref = useRef<HTMLAnchorElement>(null);
  const counted = useRef(false);

  /**
   * One impression, when the slot is actually seen.
   *
   * `IntersectionObserver` rather than a render, because a banner rendered below the fold on a page
   * nobody scrolled is not an impression and billing for it would be wrong. Half the slot has to be
   * in view; `counted` makes it once per placement per page view, so scrolling past it twice or
   * rotating back to it does not count again.
   *
   * Only the active slide observes — the inactive ones are `opacity-0` and `inert`, and an observer
   * cannot tell that from visible.
   */
  useEffect(() => {
    if (!active || counted.current) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || counted.current) continue;
          counted.current = true;
          observer.disconnect();
          void recordAdImpression(placement.id);
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [active, placement.id]);

  const desktop = resolve(placement.imageDesktopPath);
  const mobile = resolve(placement.imageMobilePath) ?? desktop;
  const desktopAlt = pickLocale(placement.imageDesktopAlt, locale);
  const mobileAlt = pickLocale(placement.imageMobileAlt, locale) || desktopAlt;

  const headline = pickLocale(placement.headline, locale);
  const subhead = pickLocale(placement.subhead, locale);
  const ctaLabel = pickLocale(placement.ctaLabel, locale);

  if (!desktop) return null;

  const external = placement.destinationUrl.startsWith('http');

  return (
    <a
      ref={ref}
      href={placement.destinationUrl}
      /*
       * `sponsored` on a paid link is what tells a search engine this is an advertisement, and
       * omitting it on a link somebody paid for is the kind of thing that costs a domain its standing.
       * `noopener` on anything that opens a new tab; `nofollow` on the own-brand case would be wrong,
       * so the rel is built from what the link actually is.
       */
      rel={
        [
          placement.isPaid ? 'sponsored' : null,
          placement.openInNewTab || external ? 'noopener' : null,
          external ? 'noreferrer' : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      target={placement.openInNewTab ? '_blank' : undefined}
      tabIndex={active ? undefined : -1}
      onClick={() => void recordAdClick(placement.id)}
      className="group relative block overflow-hidden rounded-lg border border-line bg-forest-50/40"
    >
      {/*
        The box owns the aspect ratio and the image fills it — the height is reserved before the
        creative resolves, so a late image cannot move the grid below it.
      */}
      <div className="relative aspect-[2/1] w-full sm:aspect-[4/1] lg:aspect-[5/1]">
        <Image
          src={mobile ?? desktop}
          alt={mobileAlt}
          fill
          sizes="100vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className="object-cover sm:hidden"
        />
        <Image
          src={desktop}
          alt={desktopAlt}
          fill
          sizes="(min-width: 1280px) 1200px, 100vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className="hidden object-cover sm:block"
        />

        {/*
          Copy over the creative is optional — most advertisers supply artwork that already carries
          their message — so it renders only when the fields are filled, and sits on a scrim so it
          stays legible over whatever was uploaded.
        */}
        {(headline || ctaLabel) && (
          <div className="absolute inset-y-0 left-0 flex max-w-[60%] flex-col justify-center gap-1 bg-gradient-to-r from-forest-950/70 to-transparent p-4 lg:p-6">
            {headline && (
              <p className="font-display text-base font-semibold text-cream lg:text-xl">{headline}</p>
            )}
            {subhead && <p className="hidden text-sm text-cream/80 lg:block">{subhead}</p>}
            {ctaLabel && (
              <span className="mt-1 inline-flex w-fit rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-lime-950 lg:text-sm">
                {ctaLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        The label, outside the image and on an opaque chip.

        Over the artwork it would be at the mercy of whatever was uploaded — a pale creative, a busy
        one, a creative with white space exactly there. On its own background it reads the same
        against every image, which is the whole requirement.
      */}
      {placement.isPaid && (
        <span className="absolute top-2 right-2 rounded-sm bg-ink-900/85 px-2 py-0.5 font-ui text-[11px] font-semibold tracking-wide text-cream uppercase">
          {t('sponsored')}
        </span>
      )}
    </a>
  );
}

/** A public asset or a storage object, told apart by the leading slash — same rule as the hero. */
function resolve(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? path : storageUrl('content', path);
}
