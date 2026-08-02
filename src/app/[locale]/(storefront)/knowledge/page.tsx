import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import type { Locale } from '@/lib/constants';
import { EmptyState } from '@/components/shared/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { listArticles } from '@/features/content/queries';
import { ARTICLE_TYPES, toArticleType } from '@/features/content/types';
import { ArticleCardTile } from '@/features/content/components/article-card';
import { cn } from '@/lib/utils';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** docs/02 §5 — content is ISR with tag purging, like the catalogue. */
export const revalidate = 300;

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: 'knowledge' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: {
      canonical: '/knowledge',
      languages: { sq: '/knowledge', en: '/en/knowledge' },
    },
  };
}

/**
 * docs/05 §7 — the Knowledge Center hub.
 *
 * Filters are URL state, exactly as on the shop grid: `?type=guide&tag=gjumi`. That is not
 * consistency for its own sake — it means a filtered view is a link somebody can send, the back
 * button works without any client state to restore, and the page stays static.
 */
export default async function KnowledgePage({ params, searchParams }: Props) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const type = toArticleType(first(query.type));
  const tag = first(query.tag);
  const page = Number(first(query.page) ?? '1');

  const [result, t] = await Promise.all([
    listArticles({ type, tag, page: Number.isFinite(page) ? page : 1 }),
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
    return qs ? `/knowledge?${qs}` : '/knowledge';
  };

  const featured = !type && !tag && result.page === 1 ? result.items[0] : undefined;
  const rest = featured ? result.items.slice(1) : result.items;

  return (
    <div className="container-page py-8 lg:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
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
                  ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                  : 'border-line-strong text-ink-600 hover:bg-carbon-50',
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
                    ? 'border-carbon-800 bg-carbon-800 font-medium text-white'
                    : 'border-line text-ink-600 hover:bg-carbon-50',
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
              <ArticleCardTile article={featured} className="lg:flex-row lg:items-stretch" />
            </div>
          )}

          <ol className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
