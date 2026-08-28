import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { clientEnv } from '@/lib/env.client';
import type { ArticleCard as Card } from '@/features/content/types';
import { cn } from '@/lib/utils';

/**
 * docs/05 §7 — a card in the Knowledge grid: cover, type badge, title, excerpt, reading time.
 *
 * One stretched link over the whole tile, as on the product card, so a keyboard user reaches
 * each article once rather than three times.
 *
 * The surface is `card-interactive` — the product card's ring-and-lift recipe, packaged in
 * globals.css — rather than the full-strength `border-line` box it used to draw, so the shop
 * grid and the knowledge grid answer the cursor in one voice.
 *
 * ── `featured` ──
 *
 * The hub's hero slot. It used to be this same grid card with `lg:flex-row` bolted on from the
 * call site, which produced an 18px title floating in a container-wide row — the layout changed
 * shape but nothing about the type or spacing knew it had. The variant is real: image column at
 * 55%, display-scale title, a "latest" eyebrow saying why this one is large, excerpt at body
 * size. Same stretched link, same no-cover fallback.
 */
export function ArticleCardTile({
  article,
  featured = false,
  className,
}: {
  article: Card;
  featured?: boolean;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('knowledge');

  const title = pickLocale(article.title, locale);
  const excerpt = pickLocale(article.excerpt, locale);
  const cover = article.coverPath
    ? `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/content/${article.coverPath}`
    : null;

  return (
    <article
      className={cn(
        'group relative flex card-interactive flex-col overflow-hidden rounded-lg',
        featured && 'lg:flex-row',
        className,
      )}
    >
      <div
        className={cn(
          'relative aspect-[16/9] overflow-hidden bg-forest-50',
          /* 55% image, 45% words — the image leads but the title is why anybody clicks. */
          featured && 'lg:w-[55%] lg:shrink-0',
        )}
      >
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            /*
              Measured against the ladders this card actually renders in: the hub grid is
              1/2/3/4 columns of `container-wide` (a card tops out at ~384px once the container
              saturates at 1680), the homepage band and the related-articles strip are three
              columns of narrower containers. The featured row's image column is 55% of
              container-wide, so ~872px at the cap.
            */
            sizes={
              featured
                ? '(min-width: 1800px) 872px, (min-width: 1024px) 55vw, 100vw'
                : '(min-width: 1800px) 384px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'
            }
            className="object-cover"
          />
        ) : (
          /*
           * No cover uploaded yet — a tinted panel with the type on it rather than a broken
           * image or a grey box. `pnpm seed:images` is still outstanding (docs/14 §8), so this
           * is what every seeded article renders today, and it should not look like a fault.
           *
           * `forest-600`, not `forest-800/40`. The opacity version looked right and resolved to
           * #9bb0a7 on #f0f7f3 — **2.1:1**, less than half the AA floor, and axe found 233
           * instances of it across the hub in one pass. An alpha on a text colour is a contrast
           * decision disguised as a style one; the solid token is 5.79:1 and pinned by
           * `tests/unit/contrast.test.ts`.
           */
          <div className="flex size-full items-center justify-center">
            <span className="font-display text-lg font-semibold text-forest-600">
              {t(`typeLabel.${article.type}`)}
            </span>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex flex-1 flex-col gap-2 p-4',
          featured && 'gap-3 p-6 lg:justify-center lg:p-10',
        )}
      >
        <p className="flex items-center gap-2 eyebrow">
          {/* The hero slot says why it is large: this is the newest piece, not a random big one. */}
          {featured && (
            <>
              <span>{t('latest')}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{t(`typeLabel.${article.type}`)}</span>
          {article.readingMinutes !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span data-numeric>{t('readingTime', { count: article.readingMinutes })}</span>
            </>
          )}
        </p>

        <h3
          className={cn(
            'font-display font-semibold text-forest-900',
            featured ? 'text-2xl leading-[1.1] lg:text-4xl' : 'text-lg leading-snug',
          )}
        >
          <Link href={`/knowledge/${article.slug}`} className="after:absolute after:inset-0">
            {title}
          </Link>
        </h3>

        {excerpt && (
          <p
            className={cn(
              'text-ink-600',
              featured ? 'line-clamp-2 text-base' : 'line-clamp-3 text-sm',
            )}
          >
            {excerpt}
          </p>
        )}
      </div>
    </article>
  );
}
