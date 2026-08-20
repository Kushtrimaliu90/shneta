'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { HeroSettings, HeroSlide } from '@/features/hero/types';
import type { Locale } from '@/lib/constants';
import { Carousel } from '@/components/shared/carousel';
import { HeroSlideView } from '@/features/hero/components/hero-slide';

/**
 * The homepage hero carousel.
 *
 * The mechanics — autoplay and its five pause conditions, `inert` on inactive slides, arrow keys that
 * do not steal a tab stop, horizontal-only touch, dots, zero CLS — now live in
 * `components/shared/carousel.tsx`. They were written here first and were extracted when the
 * sponsored placements needed the same behaviour: a second implementation would have started from
 * zero on all of it, and the two would have drifted the first time either was fixed.
 *
 * What stays here is the part that is genuinely about the hero — shuffle, and which slide owns the
 * `h1`. `e2e/hero.spec.ts` is what proves the extraction changed nothing a visitor can see.
 */
export function HeroCarousel({
  slides,
  settings,
  locale,
}: {
  slides: HeroSlide[];
  settings: HeroSettings;
  locale: Locale;
}) {
  const t = useTranslations('home.hero');
  const [order, setOrder] = useState<number[]>(() => slides.map((_, index) => index));

  /**
   * Shuffle, once, after hydration.
   *
   * The **anchor slide never moves** — the pinned one where there is one, the first in admin order
   * otherwise. Two reasons, and the second is the real one:
   *
   *   1. The pin exists so the brand slide holds position one while promos rotate.
   *   2. Randomising which slide renders *first* would desync the server HTML from post-hydration
   *      state and flash the wrong slide on a statically cached page. The brief asks for shuffle
   *      *and* for no flash and no CLS; where those pull apart, the hard guarantees win.
   *
   * Honest consequence: slides 2+ get equal share of the rotation, not of the first impression.
   *
   * Fixed for the session — an empty dependency list, so looping back to the start replays the same
   * order rather than reshuffling mid-visit.
   */
  useEffect(() => {
    if (!settings.shuffle || slides.length < 3) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setOrder((current) => {
      const [anchor, ...rest] = current;
      if (anchor === undefined) return current;

      // Fisher–Yates, downward, so every permutation is equally likely.
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = rest[i];
        const b = rest[j];
        if (a !== undefined && b !== undefined) {
          rest[i] = b;
          rest[j] = a;
        }
      }
      return [anchor, ...rest];
    });
    // Intentionally once per mount. Re-running would reshuffle mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sequence = useMemo(
    () => order.map((index) => slides[index]).filter((slide): slide is HeroSlide => Boolean(slide)),
    [order, slides],
  );

  return (
    <Carousel
      items={sequence}
      autoplay={settings.autoplay}
      intervalSeconds={settings.intervalSeconds}
      loop={settings.loop}
      /*
       * The hero is full-bleed, so its controls belong on the copy column's edge rather than on the
       * viewport's. See `controls` in `carousel.tsx` for the measurement that prompted it.
       */
      controls="cluster"
      /*
       * A slide picks its own ground via `text_variant`, so the chrome has to follow it. The brand
       * slide is `forest-950` and the dots were `forest-800` on it — about 1.3:1, which is to say
       * invisible on the most-viewed slide on the site.
       */
      tone={(slide) => (slide.textVariant === 'light' ? 'light' : 'dark')}
      labels={{
        region: t('carouselLabel'),
        // The shared component substitutes `{index}` and `{total}`, so the placeholders are passed
        // through rather than resolved — one label works for every slide.
        slide: t('slideLabel', { index: '{index}', total: '{total}' }),
        goTo: t('goToSlide', { index: '{index}', total: '{total}' }),
        previous: t('previous'),
        next: t('next'),
        choose: t('chooseSlide'),
      }}
      renderItem={(slide, { active, index }) => (
        <HeroSlideView
          slide={slide}
          locale={locale}
          active={active}
          /* Exactly one h1 on the page: the anchor slide's headline. The anchor never moves under
             shuffle, so this does not migrate after hydration. */
          isHeading={index === 0}
          priority={index === 0}
        />
      )}
    />
  );
}
