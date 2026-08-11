import { getTranslations } from 'next-intl/server';
import { BadgeCheck, FlaskConical, Leaf, Sparkles, Star, Tag, Target, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { getIntentTiles } from '@/features/hero/queries';

/**
 * The intent band: four routes into the catalogue, immediately below the fold.
 *
 * ── It replaces the "shop by goal" grid, rather than joining it ──
 *
 * The old homepage ran a goals grid and then a bestsellers row within one scroll, both of them
 * navigation. Adding a third navigational block would have made the top of the page three
 * consecutive answers to the same question. This band *is* that answer — one tile points at the goal
 * index, so nothing is lost, and the eight-goal grid it replaces was a list the `/goals` page already
 * renders better.
 *
 * Static, and outside the carousel on purpose: these four are how someone who did not respond to the
 * hero finds their way in, and a route that only appears every eighteen seconds is not a route.
 */

/**
 * Icon name to component.
 *
 * A closed map rather than a dynamic lookup: the name comes from a settings row, and `INTENT_ICONS` in
 * the schema is the same list, so the admin cannot save a name this cannot draw. An unknown one still
 * falls back rather than throwing — a settings row is reachable from psql.
 */
const ICONS: Record<string, LucideIcon> = {
  target: Target,
  star: Star,
  tag: Tag,
  sparkles: Sparkles,
  flask: FlaskConical,
  leaf: Leaf,
  truck: Truck,
  badge: BadgeCheck,
};

export async function IntentBand({ locale }: { locale: Locale }) {
  const t = await getTranslations('home.intent');
  const tiles = await getIntentTiles();

  // An owner who deleted every tile has said something; rendering a default would argue with them.
  if (tiles.length === 0) return null;

  return (
    <section aria-labelledby="intent-heading" className="pt-9 pb-11 lg:pt-10 lg:pb-12">
      <div className="container-page">
        <h2 id="intent-heading" className="sr-only">
          {t('heading')}
        </h2>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {tiles.map((tile) => {
            const Icon = ICONS[tile.icon] ?? Target;
            return (
            <li key={tile.href + tile.icon} className="flex">
              {/*
                The whole tile is the link — a title-only anchor inside a clickable card is the
                pattern where the visible target and the real target disagree, and on a phone the
                difference is most of the tile.
              */}
              {/*
                Horizontal on a phone, stacked from `sm` up.

                As four stacked cards these were about 250 px each — a thousand pixels of pure
                navigation between the hero and the first product, measured on a 393 × 852 screen.
                Icon beside the text instead of above it takes each row to roughly a quarter of that
                and reads better besides: on a narrow screen a list scans faster than a column of
                cards, and the tile is still one tap target either way.
              */}
              <Link
                href={tile.href}
                className="group flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500 hover:bg-forest-50/40 sm:flex-col sm:items-start sm:gap-2 sm:p-5"
              >
                <Icon className="size-5 shrink-0 text-forest-500" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium text-ink-900">
                    {pickLocale(tile.title, locale)}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-500">
                    {pickLocale(tile.body, locale)}
                  </span>
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
