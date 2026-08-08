import { getTranslations } from 'next-intl/server';
import { Sparkles, Star, Tag, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/routing';

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

const TILES: { key: 'goals' | 'bestsellers' | 'offers' | 'biohack'; href: string; icon: LucideIcon }[] =
  [
    { key: 'goals', href: '/goals', icon: Target },
    { key: 'bestsellers', href: '/shop?sort=rating', icon: Star },
    { key: 'offers', href: '/offers', icon: Tag },
    { key: 'biohack', href: '/biohack', icon: Sparkles },
  ];

export async function IntentBand() {
  const t = await getTranslations('home.intent');

  return (
    <section aria-labelledby="intent-heading" className="section-y">
      <div className="container-page">
        <h2 id="intent-heading" className="sr-only">
          {t('heading')}
        </h2>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {TILES.map(({ key, href, icon: Icon }) => (
            <li key={key} className="flex">
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
                href={href}
                className="group flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-forest-500 hover:bg-forest-50/40 sm:flex-col sm:items-start sm:gap-2 sm:p-5"
              >
                <Icon className="size-5 shrink-0 text-forest-500" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium text-ink-900">{t(`${key}.title`)}</span>
                  <span className="mt-0.5 block text-sm text-ink-500">{t(`${key}.body`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
