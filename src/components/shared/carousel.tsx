'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The carousel, as mechanics without opinions about content.
 *
 * Extracted from the hero rather than reimplemented for the sponsored placements. Everything
 * genuinely hard here — five separate autoplay pause conditions, `inert` on inactive slides,
 * arrow keys that do not steal a tab stop, horizontal-only touch, zero CLS from stacking in one grid
 * cell — was worked out once and got tests. A second implementation would have started at zero on all
 * of it, and the two would have drifted the first time either was fixed.
 *
 * ── Zero CLS by construction ──
 *
 * Every item occupies the same grid cell, so the container is as tall as its tallest child from first
 * paint. Nothing is positioned out of flow and nothing resizes when an image resolves.
 *
 * ── Autoplay pauses for five reasons ──
 *
 * Hover, focus-within, hidden tab, reduced motion, and permanently once the visitor has navigated by
 * hand. The last is the important one: someone who has taken control should not have the slide pulled
 * out from under them a few seconds later, so a manual move is a one-way switch.
 *
 * ── CSS transitions, not Framer ──
 *
 * `motion` is a dependency, but docs/13 §E keeps it off the critical path. Both users of this
 * component render above the fold.
 */
export interface CarouselLabels {
  region: string;
  /** Takes `{index}` and `{total}`. */
  slide: string;
  /** Takes `{index}` and `{total}`. */
  goTo: string;
  previous: string;
  next: string;
  choose: string;
}

export function Carousel<T extends { id: string }>({
  items,
  labels,
  autoplay,
  intervalSeconds,
  loop = true,
  arrows = true,
  controls = 'edge',
  tone,
  className,
  renderItem,
}: {
  items: T[];
  labels: CarouselLabels;
  autoplay: boolean;
  intervalSeconds: number;
  loop?: boolean;
  /** Desktop prev/next. Off for short, wide slots where they would sit over the creative. */
  arrows?: boolean;
  /**
   * Where the controls live.
   *
   * `edge` pins prev/next to the region's left and right edges and centres the dots — correct for a
   * short, contained banner, and the default so the sponsored placements are untouched.
   *
   * `cluster` gathers prev, next, dots and a slide counter into one group aligned to
   * `container-wide`'s content edge. That is the right answer for a full-bleed slide, and on the
   * hero it fixes something measurable: at 2560 the edge arrows sat about 24px from the viewport
   * border while the copy column began at 684px, so the controls were floating in the dead margin
   * roughly 650px from the content they operate. Two lone circles at the screen edges read as a
   * plugin; a cluster reads as editorial furniture.
   */
  controls?: 'edge' | 'cluster';
  /**
   * Chrome colour, resolved from the **active** item rather than set once for the carousel.
   *
   * Without it the controls are styled for a light ground, which is a real defect and not a
   * hypothetical one: the hero's brand slide is `forest-950`, and `forest-800` dots on it measure
   * about 1.3:1 — the dots were effectively invisible on the site's most-viewed slide. A carousel
   * whose slides choose their own ground has to let the chrome follow.
   */
  tone?: (item: T) => 'light' | 'dark';
  className?: string;
  renderItem: (item: T, state: { active: boolean; index: number }) => React.ReactNode;
}) {
  /*
   * Active index, the index just left, and the direction of travel — one state object because the
   * three only ever change together, and the slide transition needs all three: the incoming slide
   * animates in from the side `dir` names, the outgoing one (`previous`) animates out the other
   * way, and every other slide sits parked offscreen with its transition disabled so it teleports
   * to the correct side instead of streaking across the viewport.
   */
  const [nav, setNav] = useState<{ active: number; previous: number | null; dir: 1 | -1 }>({
    active: 0,
    previous: null,
    dir: 1,
  });
  const active = nav.active;

  /*
   * Which slide's ENTRY has been released. A slide can be parked on either side (it exits where
   * the last direction sent it), so the incoming slide is first re-staged on the side the new
   * direction names — transition off, one painted frame — and only then released to glide to
   * centre. Without the staging frame, the returning slide of a two-slide loop glides in from
   * the side it happened to exit toward, which reverses the push on every wrap. Double-rAF so
   * the parked position is actually painted before the release; guarded off the first paint so
   * the anchor slide never stages offscreen (the no-flash guarantee in hero-carousel.tsx).
   */
  const [entered, setEntered] = useState(0);
  useLayoutEffect(() => {
    if (nav.previous === null) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(nav.active));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [nav]);

  const [taken, setTaken] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  const region = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const count = items.length;

  /* Live rather than read once — a visitor can change the setting mid-session. */
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* A background tab should not burn through the rotation unseen. */
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const go = useCallback(
    (next: number, manual = false) => {
      if (manual) setTaken(true);
      setNav((current) => {
        const wrapped = ((next % count) + count) % count;
        if (wrapped === current.active) return current;
        /*
         * Direction from the RAW target, not the wrapped one: "next" off the last slide asks for
         * index `count`, which is forward travel even though it wraps to 0 — and "previous" off the
         * first asks for −1, which is backward travel to the last. Comparing wrapped indices would
         * reverse the push exactly on the wrap, which on a two-slide hero is every second move.
         */
        return { active: wrapped, previous: current.active, dir: next >= current.active ? 1 : -1 };
      });
    },
    [count],
  );

  const running = autoplay && !reduced && !taken && !hovered && !focused && visible && count > 1;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => {
        setNav((current) => {
          const next = current.active + 1;
          if (!loop && next >= count) return current;
          /* Autoplay always travels forward, the wrap included. */
          return { active: next % count, previous: current.active, dir: 1 };
        });
      },
      Math.max(3, intervalSeconds) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [running, intervalSeconds, loop, count]);

  /*
   * Arrow keys through a ref rather than an `onKeyDown` prop. A `role="region"` is not interactive,
   * so a JSX key handler on it is a lint error whose usual cure is `tabIndex={0}` — a stray tab stop
   * on a large region nobody wanted to focus. Listening on the container catches keydown bubbling
   * from the dots, the arrows and any CTA inside, which is where a keyboard user actually is.
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
   * Horizontal intent only. If the gesture travelled further vertically than horizontally it is a
   * scroll and the carousel keeps its hands off it — nothing calls `preventDefault` on the move, so
   * the page never loses native scrolling.
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

  const fill = (template: string, index: number) =>
    template.replace('{index}', String(index + 1)).replace('{total}', String(count));

  const clustered = controls === 'cluster';

  /*
   * Resolved from the active item every render, so a slide that chooses a dark ground gets light
   * chrome the moment it becomes active. `dark` chrome (dark controls for a light ground) is the
   * default and is what every existing caller gets.
   */
  const activeItem = items[active];
  const chrome = tone && activeItem ? tone(activeItem) : 'dark';
  const light = chrome === 'light';

  const arrowClass = cn(
    'inline-flex size-11 items-center justify-center rounded-full border transition-colors',
    light
      ? 'border-cream/30 bg-cream/10 text-cream hover:bg-cream/20'
      : 'border-line bg-surface/90 text-forest-800 hover:bg-surface',
  );

  /** Two digits reads as a set — "01 / 03" is furniture, "1 / 3" is a stray fraction. */
  const pad = (value: number) => String(value).padStart(2, '0');

  /* One item is not a carousel: no chrome, no timer, no live region. */
  if (count === 1 && items[0]) {
    return <div className={className}>{renderItem(items[0], { active: true, index: 0 })}</div>;
  }
  if (count === 0) return null;

  return (
    <div
      ref={region}
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      className={cn('relative', className)}
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
        `overflow-hidden` is load-bearing now: inactive slides park a full width offscreen, and
        without the clip they would widen the document and hand the page a horizontal scrollbar.
      */}
      <div className="grid overflow-hidden">
        {items.map((item, index) => {
          const isActive = index === active;
          /* The slide on its way out — the only inactive slide that animates. */
          const isLeaving = nav.previous === index && !isActive;
          /* Active but not yet released: parked on the entry side for one painted frame. */
          const isEntering = isActive && entered !== index;
          const entrySide =
            nav.dir === 1 ? 'motion-safe:translate-x-full' : 'motion-safe:-translate-x-full';
          const exitSide =
            nav.dir === 1 ? 'motion-safe:-translate-x-full' : 'motion-safe:translate-x-full';
          return (
            <div
              key={item.id}
              className={cn(
                'col-start-1 row-start-1',
                !isActive && 'pointer-events-none',
                isActive && 'z-10',
                /*
                  The push (owner, 2026-09-01): the incoming slide travels in from the side the
                  direction names while the outgoing one exits the opposite way — a full-width
                  glide on --duration-slide (700ms; the 150/250/400 scale is sized for elements
                  that move pixels, not viewports — see globals.css). Parked and staging slides
                  carry transition-none so repositioning teleports offscreen instead of streaking
                  across the viewport. `translate`, not `transform` — the Tailwind v4 gotcha
                  product-card.tsx documents.
                */
                (isActive && !isEntering) || isLeaving
                  ? 'motion-safe:transition-[translate] motion-safe:duration-[var(--duration-slide)] motion-safe:ease-[var(--ease-biocode)]'
                  : 'motion-safe:transition-none',
                isActive
                  ? isEntering
                    ? entrySide
                    : 'motion-safe:translate-x-0'
                  : isLeaving
                    ? exitSide
                    : entrySide,
                /* Reduced motion keeps the old crossfade: opacity only, per docs/04 §8. */
                'motion-reduce:transition-opacity',
                isActive
                  ? 'motion-reduce:opacity-100 motion-reduce:duration-500'
                  : 'motion-reduce:opacity-0 motion-reduce:duration-300',
              )}
              /*
                `inert` does what `aria-hidden` alone cannot: it takes the inactive item's links out of
                the tab order as well as out of the accessibility tree. Without it a keyboard user tabs
                into a link they cannot see and focus appears to vanish.
              */
              {...(isActive ? {} : { inert: true, 'aria-hidden': true })}
              aria-roledescription="slide"
              aria-label={fill(labels.slide, index)}
            >
              {renderItem(item, { active: isActive, index })}
            </div>
          );
        })}
      </div>

      {arrows && !clustered && (
        <>
          <button
            type="button"
            onClick={() => go(active - 1, true)}
            aria-label={labels.previous}
            className="absolute top-1/2 left-2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-forest-800 transition-colors hover:bg-surface lg:inline-flex"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(active + 1, true)}
            aria-label={labels.next}
            className="absolute top-1/2 right-2 z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-forest-800 transition-colors hover:bg-surface lg:inline-flex"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </>
      )}

      {/*
        The control row.

        `cluster` gathers prev, next, the dots and the counter into one group and aligns it to
        `container-wide`'s content edge, which is the same edge the hero's copy column starts on —
        so the controls sit under the headline they belong to instead of in the margin. `edge`
        keeps the centred dots the contained banners were built around.

        Everything below `sm` is deliberately identical in both modes. The phone arrangement is
        measured to 17 px of fold headroom and `e2e/hero.spec.ts` asserts that no dot lands on a
        CTA; the cluster's extra furniture is `lg`-only for exactly that reason.
      */}
      <div
        /*
         * In normal flow on a phone, absolutely positioned from sm up.
         *
         * Overlaid, the active dot landed **on** the hero CTA row — and because it is forest-800, the
         * same colour as the primary button, it merged into it and read as a squared-off bottom-right
         * corner rather than as a dot. Two reported defects, one cause. z-index would only have
         * decided which of them sat on top; the dot has no business over a tap target at all.
         *
         * Desktop keeps the overlay: there the slide is tall enough that the dots sit in dead space
         * below the copy, and pulling them into flow would add height to a hero that does not need it.
         */
        /*
         * The band the dots live in, which has to belong to the carousel rather than to whatever
         * follows it.
         *
         * The first version had `mt-2` and no bottom margin, which measured 20 px above the dots and
         * **0 px** below: the trust strip began on the dots' bottom edge, so an 8 px row of dots and a
         * 116 px band of icons read as one crowded strip. Reported from a phone, and the measurement
         * agreed exactly.
         *
         * Slightly tighter above and a real gap below. The asymmetry is the point — a control sits
         * closer to the thing it controls, so 16/12 reads as "these belong to the carousel" where
         * 20/0 read as "these belong to the trust strip".
         */
        className={cn(
          'relative z-20 mt-1 mb-3 flex justify-center sm:absolute sm:inset-x-0 sm:mt-0 sm:mb-0',
          clustered ? 'sm:bottom-6 lg:container-wide lg:justify-start' : 'sm:bottom-3 lg:bottom-4',
        )}
      >
        <div className={cn('flex items-center gap-3', clustered && 'lg:gap-4')}>
          {clustered && arrows && (
            <div className="hidden items-center gap-2 lg:flex short:lg:hidden">
              <button
                type="button"
                onClick={() => go(active - 1, true)}
                aria-label={labels.previous}
                className={arrowClass}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(active + 1, true)}
                aria-label={labels.next}
                className={arrowClass}
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* A real tablist, so a screen reader can say which item is current and move between them. */}
          <div role="tablist" aria-label={labels.choose} className="flex items-center gap-2">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={index === active}
                aria-label={fill(labels.goTo, index)}
                onClick={() => go(index, true)}
                className={cn(
                  'relative',
                  // A 24 px hit area around a 8 px dot: the visual stays small, the target does not.
                  'h-2 rounded-full transition-all before:absolute before:-inset-2 before:content-[""]',
                  index === active ? 'w-6' : 'w-2',
                  light
                    ? index === active
                      ? 'bg-cream'
                      : 'bg-cream/35 hover:bg-cream/60'
                    : index === active
                      ? 'bg-forest-800'
                      : 'bg-forest-800/30 hover:bg-forest-800/60',
                )}
              />
            ))}
          </div>

          {/*
            The counter carries no information the live region below does not already announce, so
            it is `aria-hidden` rather than a second thing for a screen reader to read out. It is
            here because a cluster of two arrows and three dots does not say *how many* — and
            "01 / 03" is what turns a set of controls into editorial furniture.
          */}
          {clustered && (
            <span
              aria-hidden="true"
              data-numeric
              className={cn(
                'hidden font-ui text-[13px] font-semibold tracking-wide lg:inline',
                light ? 'text-cream/70' : 'text-ink-500',
              )}
            >
              {pad(active + 1)} / {pad(count)}
            </span>
          )}
        </div>
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {fill(labels.slide, active)}
      </p>
    </div>
  );
}
