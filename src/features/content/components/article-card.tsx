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
 */
export function ArticleCardTile({ article, className }: { article: Card; className?: string }) {
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
        'group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-forest-50">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
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

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="flex items-center gap-2 eyebrow">
          <span>{t(`typeLabel.${article.type}`)}</span>
          {article.readingMinutes !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span data-numeric>{t('readingTime', { count: article.readingMinutes })}</span>
            </>
          )}
        </p>

        <h3 className="font-display text-lg leading-snug font-semibold text-forest-900">
          <Link href={`/knowledge/${article.slug}`} className="after:absolute after:inset-0">
            {title}
          </Link>
        </h3>

        {excerpt && <p className="line-clamp-3 text-sm text-ink-600">{excerpt}</p>}
      </div>
    </article>
  );
}
