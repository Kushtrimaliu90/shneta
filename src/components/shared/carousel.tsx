'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  className?: string;
  renderItem: (item: T, state: { active: boolean; index: number }) => React.ReactNode;
}) {
  const [active, setActive] = useState(0);
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
      setActive(((next % count) + count) % count);
    },
    [count],
  );

  const running = autoplay && !reduced && !taken && !hovered && !focused && visible && count > 1;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setActive((current) => {
        const next = current + 1;
        if (!loop && next >= count) return current;
        return next % count;
      });
    }, Math.max(3, intervalSeconds) * 1000);
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
      <div className="grid">
        {items.map((item, index) => {
          const isActive = index === active;
          return (
            <div
              key={item.id}
              className={cn(
                'col-start-1 row-start-1 transition-opacity motion-reduce:transition-none',
                isActive
                  ? 'z-10 opacity-100 duration-500'
                  : 'pointer-events-none opacity-0 duration-300',
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

      {arrows && (
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

      {/* A real tablist, so a screen reader can say which item is current and move between them. */}
      <div
        role="tablist"
        aria-label={labels.choose}
        className="absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2 lg:bottom-4"
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={fill(labels.goTo, index)}
            onClick={() => go(index, true)}
            className={cn(
              'h-2 rounded-full transition-all',
              index === active ? 'w-6 bg-forest-800' : 'w-2 bg-forest-800/30 hover:bg-forest-800/60',
            )}
          />
        ))}
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {fill(labels.slide, active)}
      </p>
    </div>
  );
}
