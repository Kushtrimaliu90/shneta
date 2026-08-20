import {
  BadgeCheck,
  Clock,
  FlaskConical,
  Pause,
  Play,
  RotateCcw,
  Truck,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Locale } from '@/lib/constants';
import type { TrustItem } from '@/features/hero/types';
import { cn } from '@/lib/utils';

/**
 * The persistent trust strip: one continuously sliding line under the carousel.
 *
 * ── Why it does not rotate, even though it moves ──
 *
 * These four facts are the reason someone completes a first order from a shop they have not heard
 * of. A *carousel* would mean three quarters of them are invisible at any moment, and the one a given
 * visitor needed is the one that had just slid away. A marquee is the opposite: every promise passes
 * every visitor, and nothing is ever hidden behind a timer.
 *
 * ── The motion is a deliberate exception, and it is fenced ──
 *
 * docs/04 §8 says "no continuous ambient animation". This is the one place on the site that breaks
 * that, requested explicitly, and it ships with the three things such an element needs rather than
 * with the motion alone:
 *
 *   1. **A pause control.** WCAG 2.2.2 (Level A) requires a mechanism to pause, stop or hide anything
 *      that moves automatically, runs longer than five seconds and sits beside other content — all
 *      three are true here. The items are plain text rather than links, so `:focus-within` never fires
 *      and hover-pause alone would leave every keyboard and touch user without a way to stop it. The
 *      toggle is a real checkbox with a label, so it costs no JavaScript on a route that renders above
 *      the fold (docs/13 §E) and still works with a keyboard.
 *   2. **`prefers-reduced-motion` stops it, rather than slowing it.** The animation is declared only
 *      inside `no-preference`; see the note in `globals.css` for why relying on the global 0.01ms
 *      override instead would freeze the track at a half-scrolled offset.
 *   3. **Hover and focus pause**, so reading a promise does not turn into chasing it.
 *
 * ── Four copies, and why the spacing is padding rather than `gap` ──
 *
 * The track holds four identical copies and translates `-25%`, which is exactly one copy's width, so
 * the loop is seamless. That only holds if the copies are *equal width including their trailing
 * space*, which is why the spacing between items is `px` on each item and a right border on each
 * copy: a flex `gap` between copies is not part of a percentage translate, and the shortfall shows as
 * a jump once per cycle. Four rather than two so the track is wider than the container even when the
 * labels are short — three copies is the arithmetic minimum at 1680px and four leaves room for a
 * longer locale.
 *
 * Only the first copy is readable; the rest are `aria-hidden`, or a screen reader announces the same
 * four promises four times.
 *
 * ── Small type, no boxes ──
 *
 * docs/04 asks for restraint and the brief asks for a quiet horizontal line. The old version was four
 * cards with titles *and* body copy, which is a features grid — it read as marketing rather than as
 * reassurance. One line each, muted, icons at text size.
 *
 * ── Still 50px tall ──
 *
 * This strip sits inside the hero's fold budget: 180px below the hero, of which the category strip
 * needs 107 (see `hero-slide.tsx`). An earlier attempt at `py-4` added four pixels and that was enough
 * to push the category pills below the fold at 1366 x 625. So the toggle earns its 44px hit area with
 * a negative margin rather than with height, exactly like the announcement bar's dismiss button.
 */

/** Named icons rather than free text, so an admin cannot save one that renders as nothing. */
const ICONS: Record<string, LucideIcon> = {
  truck: Truck,
  clock: Clock,
  flask: FlaskConical,
  rotate: RotateCcw,
  badge: BadgeCheck,
  wallet: Wallet,
};

/** One copy is read, three are scenery. See the note above on why it is four and not two. */
const COPIES = [0, 1, 2, 3];

export function TrustStrip({
  items,
  locale,
  freeShippingThreshold,
}: {
  items: TrustItem[];
  locale: Locale;
  /** Formatted, e.g. "€30". Interpolated into any label containing `{threshold}`. */
  freeShippingThreshold: string;
}) {
  if (items.length === 0) return null;

  const sq = locale === 'sq';

  /*
   * Inline rather than message keys, matching the `aria-label` below it. Both strings are chrome for
   * one component in one place; adding two keys to both locale files to serve a single control is the
   * kind of indirection that makes the message catalogue hard to audit.
   */
  const pauseLabel = sq ? 'Ndalo rrëshqitjen e shiritit' : 'Pause the sliding strip';

  const labels = items.map((item) => {
    /*
     * `{threshold}` is interpolated from the real cheapest active shipping method rather than baked
     * into the copy. The previous homepage said "Free delivery over €30" in a message string while
     * the cart read the actual number from settings — change a shipping method and only one of the
     * two updated.
     */
    const text = (sq ? item.sq : item.en).replace('{threshold}', freeShippingThreshold);
    return { icon: item.icon, text };
  });

  return (
    <section
      data-trust-strip
      aria-label={sq ? 'Pse të blini te BIOCODE' : 'Why shop with BIOCODE'}
      className="marquee-region border-y border-line bg-surface"
    >
      {/*
        `py-3 lg:py-3.5` is the strip's whole height — 50px at `lg` — and it belongs on this row rather
        than on the copies, because the copies slide and their padding would slide with them. Restoring
        it after the marquee rewrite is not cosmetic: without it the strip measured **22px**, which
        reads as a broken rule rather than as a band. It also has to stay exactly this: the fold budget
        below the hero is 180px, and the category strip needs 107 of it (see `hero-slide.tsx`).
      */}
      <div className="container-wide flex items-center gap-1 py-3 lg:py-3.5">
        <div className="min-w-0 flex-1 marquee-viewport">
          <div className="flex w-max marquee-track motion-reduce:w-full">
            {COPIES.map((copy) => (
              <ul
                key={copy}
                /* Copies 2-4 exist only to fill the loop; they must not be read out. */
                aria-hidden={copy > 0 || undefined}
                className={cn(
                  'flex shrink-0 divide-x divide-line border-r border-line',
                  /*
                   * Reduced motion keeps one copy and spreads it, which is the strip as it was before
                   * the marquee: a divided row that fills the container. The trailing border goes with
                   * the loop it existed for.
                   */
                  copy === 0
                    ? 'motion-reduce:w-full motion-reduce:border-r-0'
                    : 'motion-reduce:hidden',
                )}
              >
                {labels.map(({ icon, text }) => {
                  const Icon = ICONS[icon] ?? BadgeCheck;
                  return (
                    <li
                      key={`${icon}-${text}`}
                      className="flex shrink-0 items-center gap-2 px-5 text-sm whitespace-nowrap text-ink-600 lg:px-7 motion-reduce:lg:flex-1 motion-reduce:lg:justify-center"
                    >
                      <Icon
                        className="size-4 shrink-0 text-forest-500 lg:size-5"
                        aria-hidden="true"
                      />
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            ))}
          </div>
        </div>

        {/*
          The pause toggle. A checkbox inside its own label: no JavaScript, keyboard operable, and the
          checked state is what a screen reader announces, so the label can stay constant instead of
          having to flip between "pause" and "play".

          `-my-3` buys the 44px hit area out of the strip's existing height rather than adding to it —
          see the fold-budget note above. Hidden entirely under reduced motion, where there is nothing
          to pause.
        */}
        <label
          className="marquee-toggle -my-3 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-500 transition-colors hover:text-forest-800 motion-reduce:hidden"
          title={pauseLabel}
        >
          <input type="checkbox" className="marquee-pause peer sr-only" aria-label={pauseLabel} />
          <Pause className="size-4 peer-checked:hidden" aria-hidden="true" />
          <Play className="hidden size-4 peer-checked:block" aria-hidden="true" />
        </label>
      </div>
    </section>
  );
}
