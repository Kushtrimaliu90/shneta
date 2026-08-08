'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HeroSettings, HeroSlide } from '@/features/hero/types';
import type { Locale } from '@/lib/constants';
import { HeroSlideView } from '@/features/hero/components/hero-slide';
import { cn } from '@/lib/utils';

/**
 * The homepage hero carousel.
 *
 * ── Zero CLS by construction ──
 *
 * Every slide is stacked in the same grid cell (`grid` + `col-start-1 row-start-1`), so the container
 * is exactly as tall as its tallest slide from first paint. Nothing is absolutely positioned out of
 * flow and nothing resizes when an image resolves, which means the height is settled before any
 * network request finishes — the measured baseline was CLS 0.0000 and that is the number to protect.
 *
 * ── Autoplay pauses for five separate reasons ──
 *
 * Hover, focus-within, hidden tab, reduced motion, and permanently once the visitor has navigated by
 * hand. The last one is the important one: someone who has taken control should not have the slide
 * yanked out from under them three seconds later, so a manual move is a one-way switch rather than a
 * temporary pause.
 *
 * ── CSS transitions, not Framer ──
 *
 * `motion` is a dependency here, but docs/13 §E keeps it off the critical path — the hero is the LCP
 * element and a 30 kB animation library in front of it would be a strange way to spend the budget.
 * Opacity and a small translate do everything this needs.
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
  const [active, setActive] = useState(0);
  const [taken, setTaken] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [order, setOrder] = useState<number[]>(() => slides.map((_, index) => index));

  const region = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  /* prefers-reduced-motion, live rather than read once — a visitor can change it mid-session. */
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* Page Visibility — a background tab should not burn through six slides unseen. */
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  /**
   * Shuffle, once, after hydration.
   *
   * ── What is shuffled, and what deliberately is not ──
   *
   * The **anchor slide never moves**. That is the pinned slide when one exists, and the first in admin
   * order otherwise; everything after it is permuted. Two reasons, and the second is the real one:
   *
   *   1. The pin exists precisely so the brand slide holds position one while promos rotate.
   *   2. Randomising which slide renders *first* would mean the server-rendered HTML and the
   *      post-hydration state disagree, and the visitor would watch the hero swap under them — a
   *      visible flash of the wrong slide and, on a statically cached page, a layout the server could
   *      never have got right. The brief asks for shuffle *and* for no flash and no CLS; when those
   *      pull against each other, the two hard guarantees win.
   *
   * The honest consequence: with shuffle on, slides 2+ get equal share of the *rotation*, not of the
   * first impression. Equal first impressions would require either a dynamic page or an accepted
   * flash, and neither is worth it for a promo slot.
   *
   * Fixed for the session — this effect has an empty dependency list, so a loop back to the start
   * replays the same order rather than reshuffling mid-visit.
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

  const count = slides.length;
  const go = useCallback(
    (next: number, manual = false) => {
      if (manual) setTaken(true);
      setActive(((next % count) + count) % count);
    },
    [count],
  );

  const autoplayOn =
    settings.autoplay && !reduced && !taken && !hovered && !focused && visible && count > 1;

  useEffect(() => {
    if (!autoplayOn) return;
    const timer = window.setInterval(() => {
      setActive((current) => {
        const next = current + 1;
        // `loop: false` parks on the last slide rather than snapping back.
        if (!settings.loop && next >= count) return current;
        return next % count;
      });
    }, settings.intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoplayOn, settings.intervalSeconds, settings.loop, count]);

  /**
   * Arrow keys, scoped to the carousel.
   *
   * Attached to the container through a ref rather than as an `onKeyDown` prop, for two reasons that
   * happen to agree. A `role="region"` is not an interactive element, so a JSX key handler on it is
   * `jsx-a11y/no-noninteractive-element-interactions` — and the usual way to silence that is
   * `tabIndex={0}`, which buys a stray tab stop on a large region nobody wanted to focus.
   *
   * Listening on the container catches keydown bubbling from anything inside it, so arrows work
   * whenever focus is on a dot, an arrow button or a CTA — which is where a keyboard user actually
   * is — without the carousel itself becoming a tab stop. Global handlers were the other option and
   * would fight every other arrow-key surface on the page.
   */
  useEffect(() => {
    const node = region.current;
    if (!node) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      go(active + (event.key === 'ArrowLeft' ? -1 : 1), true);
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [active, go]);

  /*
   * Touch. Horizontal intent only: if the gesture has travelled further vertically than
   * horizontally it is a scroll, and the carousel keeps its hands off it. Nothing calls
   * `preventDefault` on the move, so the page never loses its native scrolling.
   */
  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    if (point) touchStart.current = { x: point.clientX, y: point.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    const point = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !point) return;

    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;

    go(active + (dx < 0 ? 1 : -1), true);
  };

  /** The DOM order after shuffle. Slides are rendered in this order and indexed by it. */
  const sequence = useMemo(
    () => order.map((index) => slides[index]).filter((slide): slide is HeroSlide => Boolean(slide)),
    [order, slides],
  );

  /*
   * One slide is not a carousel. No dots, no arrows, no live region, no autoplay timer — just the
   * slide, which is what the brief asks for and also what the site looks like today.
   */
  if (sequence.length === 1 && sequence[0]) {
    return (
      <HeroSlideView
        slide={sequence[0]}
        locale={locale}
        active
        isHeading
        priority
      />
    );
  }

  if (sequence.length === 0) return null;

  return (
    <div
      ref={region}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('carouselLabel')}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/*
        Every slide occupies the same grid cell. The container is as tall as the tallest slide from
        the first frame, so switching slides cannot move anything below the hero.
      */}
      <div className="grid">
        {sequence.map((slide, index) => {
          const isActive = index === active;
          return (
            <div
              key={slide.id}
              className={cn(
                'col-start-1 row-start-1 transition-opacity motion-reduce:transition-none',
                isActive ? 'z-10 opacity-100 duration-500' : 'pointer-events-none opacity-0 duration-300',
              )}
              /*
                `inert` does what `aria-hidden` alone cannot: it takes the inactive slide's links out
                of the tab order as well as out of the accessibility tree. Without it a keyboard user
                tabs into a CTA they cannot see, and focus appears to vanish.
              */
              {...(isActive ? {} : { inert: true, 'aria-hidden': true })}
              aria-roledescription="slide"
              aria-label={t('slideLabel', { index: index + 1, total: sequence.length })}
            >
              <HeroSlideView
                slide={slide}
                locale={locale}
                active={isActive}
                /* Exactly one h1 on the page: the anchor slide's headline. The anchor never moves
                   under shuffle, so this does not migrate after hydration. */
                isHeading={index === 0}
                priority={index === 0}
              />
            </div>
          );
        })}
      </div>

      {/* Desktop only. On a phone the swipe is the control and arrows would sit over the copy. */}
      <button
        type="button"
        onClick={() => go(active - 1, true)}
        aria-label={t('previous')}
        className="absolute top-1/2 left-2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-forest-800 transition-colors hover:bg-surface lg:inline-flex"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => go(active + 1, true)}
        aria-label={t('next')}
        className="absolute top-1/2 right-2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-forest-800 transition-colors hover:bg-surface lg:inline-flex"
      >
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>

      {/*
        Dots. A real tablist rather than decorative dots, so a screen reader can say which slide is
        current and move between them — and each one names the slide it goes to rather than "3".
      */}
      <div
        role="tablist"
        aria-label={t('chooseSlide')}
        className="absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2 lg:bottom-4"
      >
        {sequence.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={t('goToSlide', { index: index + 1, total: sequence.length })}
            onClick={() => go(index, true)}
            className={cn(
              'h-2 rounded-full transition-all',
              index === active
                ? 'w-6 bg-forest-800'
                : 'w-2 bg-forest-800/30 hover:bg-forest-800/60',
            )}
          />
        ))}
      </div>

      {/* Announces the change to a screen reader without stealing focus. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {t('slideLabel', { index: active + 1, total: sequence.length })}
      </p>
    </div>
  );
}
