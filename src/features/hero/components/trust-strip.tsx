import { BadgeCheck, Clock, FlaskConical, RotateCcw, Truck, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Locale } from '@/lib/constants';
import type { TrustItem } from '@/features/hero/types';

/**
 * The persistent trust strip: one quiet line under the carousel that never rotates.
 *
 * ── Why it does not rotate ──
 *
 * These four facts are the reason someone completes a first order from a shop they have not heard
 * of. Putting them inside the carousel would mean three quarters of them are invisible at any moment,
 * and the one a given visitor needed is the one that had just slid away.
 *
 * ── Small type, no boxes ──
 *
 * docs/04 asks for restraint and the brief asks for a quiet horizontal line. The old version was four
 * cards with titles *and* body copy, which is a features grid — it read as marketing rather than as
 * reassurance. One line each, muted, icons at text size.
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

  return (
    <section
      data-trust-strip
      aria-label={locale === 'sq' ? 'Pse të blini te BIOCODE' : 'Why shop with BIOCODE'}
      className="border-y border-line bg-surface"
    >
      {/*
        Four promises across a 1680px tier read as sparse rather than generous: each cell was 420px
        wide with its content pinned left, so the row was mostly gap. Dividers instead of gap turn the
        same spacing into structure, and centring each item in its cell stops the last one drifting
        away from the edge it is nearest.

        On a phone it is a single scrolling rail rather than a 2 x 2 grid, and that is the change that
        finally put the category pills inside a phone's first screen. Four promises in two rows cost
        **116px**; one row costs 50, and the 66px reclaimed is what moved the pills from 25px visible
        to fully visible at 390 x 844. Two rows of two was also the clumsier reading order — a rail
        scans left to right the way the desktop row does.

        Deliberately **zero** extra height at `lg`, and that is not fussiness. This strip sits inside
        the hero's fold budget — 180px below the hero, of which the category strip needs 107 (see
        `hero-slide.tsx`) — and a first attempt at `py-4` added four pixels, which was enough to push
        the category pills back below the fold at 1366 x 625. Presence here has to come from
        arrangement, never from padding. The cell padding is `xl:` and not `lg:` for the same reason:
        at 1024 the labels wrapped inside a 6rem-padded cell and the strip grew to 74px.
      */}
      <ul className="container-wide -mx-5 no-scrollbar flex snap-x gap-6 overflow-x-auto py-3 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-line lg:overflow-visible lg:py-3.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon] ?? BadgeCheck;
          /*
           * `{threshold}` is interpolated from the real cheapest active shipping method rather than
           * baked into the copy. The previous homepage said "Free delivery over €30" in a message
           * string while the cart read the actual number from settings — change a shipping method and
           * only one of the two updated.
           */
          const label = (locale === 'sq' ? item.sq : item.en).replace(
            '{threshold}',
            freeShippingThreshold,
          );

          return (
            <li
              key={`${item.icon}-${label}`}
              className="flex shrink-0 snap-start items-center gap-2 text-sm whitespace-nowrap text-ink-600 lg:justify-center xl:px-6"
            >
              <Icon className="size-4 shrink-0 text-forest-500 lg:size-5" aria-hidden="true" />
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
