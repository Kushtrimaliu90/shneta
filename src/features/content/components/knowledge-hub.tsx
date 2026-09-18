import { getTranslations } from 'next-intl/server';
import { BookOpen } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { listArticles } from '@/features/content/queries';
import { ARTICLE_TYPES, type ArticleType } from '@/features/content/types';
import { ArticleCardTile } from '@/features/content/components/article-card';
import { cn } from '@/lib/utils';

/**
 * The Knowledge Center hub body (docs/05 §7), shared by two routes (owner cost report,
 * 2026-09-18):
 *
 *   · `/knowledge` renders it with no filters and is PRERENDERED — the docs/02 §5 content tier
 *     its `revalidate = 86400` always intended, which its unconditional searchParams read had
 *     silently defeated: every visit to the hub was a billed dynamic render.
 *   · `/knowledge/f` reads `?type/?tag/?page` and stays dynamic — filters remain URL state a
 *     reader can send and the back button can restore, exactly as before; only the URL of a
 *     FILTERED view gains the `/f` segment. The middleware redirects legacy query URLs there.
 *
 * Every filter chip, tag pill and pagination link is built by `href` below, which returns to
 * the bare prerendered `/knowledge` the moment its query empties.
 */
export async function KnowledgeHub({
  type,
  tag,
  page = 1,
}: {
  type?: ArticleType;
  tag?: string;
  page?: number;
}) {
  const [result, t] = await Promise.all([
    listArticles({ type, tag, page }),
    getTranslations('knowledge'),
  ]);

  const href = (next: { type?: string; tag?: string; page?: number }) => {
    const params = new URLSearchParams();
    const nextType = 'type' in next ? next.type : type;
    const nextTag = 'tag' in next ? next.tag : tag;
    if (nextType) params.set('type', nextType);
    if (nextTag) params.set('tag', nextTag);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const qs = params.toString();
    return qs ? `/knowledge/f?${qs}` : '/knowledge';
  };

  const featured = !type && !tag && result.page === 1 ? result.items[0] : undefined;
  const rest = featured ? result.items.slice(1) : result.items;

  return (
    <div className="container-wide py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
          {t('title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-600">{t('intro')}</p>
      </header>

      <nav aria-label={t('filterLabel')} className="flex flex-wrap gap-1.5">
        {[undefined, ...ARTICLE_TYPES].map((value) => {
          const active = value === type;
          const count = value ? (result.countsByType[value] ?? 0) : (result.countsByType.all ?? 0);
          if (value && count === 0) return null;

          return (
            <Link
              key={value ?? 'all'}
              href={href({ type: value, page: 1 })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors',
                active
                  ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                  : 'border-line-strong text-ink-600 hover:bg-forest-50',
              )}
            >
              {value ? t(`types.${value}`) : t('all')}
              <span className="font-ui text-xs text-ink-600" data-numeric>
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {result.tags.length > 0 && (
        <nav aria-label={t('tags')} className="mt-3 flex flex-wrap gap-1.5">
          {result.tags.map((value) => {
            const active = value === tag;
            return (
              <Link
                key={value}
                href={href({ tag: active ? undefined : value, page: 1 })}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-8 items-center rounded-full border px-3 text-xs transition-colors',
                  active
                    ? 'border-forest-800 bg-forest-800 font-medium text-white'
                    : 'border-line text-ink-600 hover:bg-forest-50',
                )}
              >
                #{value}
              </Link>
            );
          })}
        </nav>
      )}

      {result.items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={type || tag ? t('empty') : t('empty')}
          body={type || tag ? t('emptyHint') : t('emptyHint')}
          className="mt-10"
          action={
            type || tag ? (
              <Link href="/knowledge" className={buttonVariants({ variant: 'secondary' })}>
                {t('clearFilters')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {featured && (
            /*
             * The hero is the newest article, and only on the unfiltered first page. Keeping it
             * while a filter is on would show one article twice — once large, once in the grid —
             * which reads as a duplicate rather than as emphasis.
             */
            <div className="mt-8">
              <ArticleCardTile article={featured} featured />
            </div>
          )}

          <ol className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
            {rest.map((article) => (
              <li key={article.slug} className="flex">
                <ArticleCardTile article={article} className="w-full" />
              </li>
            ))}
          </ol>

          {result.pageCount > 1 && (
            <nav aria-label={t('pagination')} className="mt-8 flex items-center gap-3">
              {result.page > 1 && (
                <Link
                  href={href({ page: result.page - 1 })}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  {t('previous')}
                </Link>
              )}
              <span className="text-sm text-ink-600" data-numeric>
                {t('pageOf', { page: result.page, total: result.pageCount })}
              </span>
              {result.page < result.pageCount && (
                <Link
                  href={href({ page: result.page + 1 })}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  {t('next')}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
