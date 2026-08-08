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
      <ul className="container-page grid grid-cols-2 gap-x-6 gap-y-2.5 py-3 lg:grid-cols-4 lg:py-3.5">
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
            <li key={`${item.icon}-${label}`} className="flex items-center gap-2 text-sm text-ink-600">
              <Icon className="size-4 shrink-0 text-forest-500" aria-hidden="true" />
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
