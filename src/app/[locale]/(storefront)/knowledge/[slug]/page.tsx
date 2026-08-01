import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, Info } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { resolveLocale } from '@/i18n/locale';
import { isLocaleFallback, pickLocale } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { truncate } from '@/lib/utils';
import { articleSchema, breadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/shared/json-ld';
import { ProductImage } from '@/components/storefront/product-image';
import { PriceTag } from '@/components/storefront/price-tag';
import type { Locale } from '@/lib/constants';
import { getArticle, listArticleSlugs, listRelatedArticles } from '@/features/content/queries';
import { MarkdownBody } from '@/features/content/components/markdown-body';
import { ArticleCardTile } from '@/features/content/components/article-card';
import { ShareButton } from '@/features/content/components/share-button';

type Props = { params: Promise<{ locale: string; slug: string }> };

export const revalidate = 300;

/** docs/02 §5 — every published article is prebuilt; new ones render on demand. */
export async function generateStaticParams() {
  const slugs = await listArticleSlugs();
  return slugs.slice(0, 200).map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale);
  const article = await getArticle(slug);
  if (!article) return {};

  const title = pickLocale(article.seoTitle, locale) || pickLocale(article.title, locale);
  const description =
    pickLocale(article.seoDescription, locale) ||
    pickLocale(article.excerpt, locale) ||
    truncate(pickLocale(article.body, locale), 155);

  return {
    title,
    description,
    alternates: {
      canonical: `/knowledge/${slug}`,
      languages: { sq: `/knowledge/${slug}`, en: `/en/knowledge/${slug}` },
    },
    openGraph: { title, description, type: 'article' },
  };
}

/**
 * docs/05 §7 — one article.
 *
 * The body is markdown from the database, rendered through `MarkdownBody`, which sanitises.
 * Nothing on this page uses `dangerouslySetInnerHTML`.
 */
export default async function ArticlePage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const article = await getArticle(slug);
  if (!article) notFound();

  const [t, related] = await Promise.all([
    getTranslations(),
    listRelatedArticles(slug, article.type),
  ]);

  const title = pickLocale(article.title, locale);
  const body = pickLocale(article.body, locale);
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;

  /*
   * docs/05 §7 acceptance — an English reader on an Albanian-only piece gets the Albanian body
   * with a note, not an empty page. `isLocaleFallback` is the same helper the PDP uses; the
   * seeded news item is deliberately Albanian-only so this path is exercised on every run.
   */
  const isFallback = isLocaleFallback(article.body, locale);

  const cover = article.coverPath
    ? `${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/content/${article.coverPath}`
    : null;

  const published = article.publishedAt
    ? new Date(article.publishedAt).toISOString().slice(0, 10)
    : null;

  return (
    <>
      <JsonLd
        schema={articleSchema(origin, {
          slug,
          title,
          excerpt: pickLocale(article.excerpt, locale),
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
        })}
      />
      <JsonLd
        schema={breadcrumbSchema(origin, [
          { name: t('knowledge.title'), path: '/knowledge' },
          { name: title, path: `/knowledge/${slug}` },
        ])}
      />

      <div className="container-page py-8 lg:py-12">
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-forest-800 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('knowledge.backToKnowledge')}
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-14">
          <article className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 eyebrow">
              <span>{t(`knowledge.typeLabel.${article.type}`)}</span>
              {published && (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={article.publishedAt ?? undefined} data-numeric>
                    {published}
                  </time>
                </>
              )}
              {article.readingMinutes !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span data-numeric>
                    {t('knowledge.readingTime', { count: article.readingMinutes })}
                  </span>
                </>
              )}
            </p>

            <h1 className="mt-3 font-display text-3xl font-semibold text-forest-900 lg:text-4xl">
              {title}
            </h1>

            {cover && (
              <div className="mt-6 overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover} alt="" className="w-full object-cover" />
              </div>
            )}

            {isFallback && (
              <p className="mt-6 flex items-center gap-2 rounded-sm border border-line bg-forest-50 px-3 py-2 text-sm text-ink-600">
                <Info className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
                {t('knowledge.onlyAlbanian')}
              </p>
            )}

            <div className="mt-8">
              <MarkdownBody markdown={body} />
            </div>

            <div className="mt-8 flex items-center gap-3 border-t border-line pt-6">
              <ShareButton title={title} />
            </div>

            {/* docs/08 §7.3 — the disclaimer belongs on every page carrying health copy. */}
            <p className="mt-6 text-xs leading-relaxed text-ink-500">{t('footer.disclaimer')}</p>
          </article>

          <aside className="flex flex-col gap-8 lg:sticky lg:top-24 lg:self-start">
            {article.products.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold text-forest-900">
                  {t('knowledge.shopThisArticle')}
                </h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {article.products.map((product) => {
                    const name = pickLocale(product.name, locale);
                    return (
                      <li key={product.slug}>
                        <Link
                          href={`/product/${product.slug}`}
                          className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5 transition-shadow hover:shadow-md"
                        >
                          <div className="size-14 shrink-0 overflow-hidden rounded-sm bg-cream">
                            <ProductImage
                              path={product.imagePath}
                              alt={name}
                              sizes="56px"
                              className="size-14 p-1.5"
                            />
                          </div>
                          <span className="min-w-0 flex-1">
                            {product.brandName && (
                              <span className="block eyebrow">{product.brandName}</span>
                            )}
                            <span className="block text-sm font-medium text-ink-900">{name}</span>
                            {product.priceCents !== null && (
                              <PriceTag priceCents={product.priceCents} className="mt-0.5" />
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {article.ingredients.length > 0 && (
              <section>
                <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
                  {t('knowledge.relatedIngredients')}
                </h2>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {article.ingredients.map((ingredient) => (
                    <li key={ingredient.slug}>
                      <Link
                        href={`/ingredients/${ingredient.slug}`}
                        className="inline-flex rounded-sm border border-line px-2.5 py-1 text-sm text-ink-900 hover:bg-forest-50"
                      >
                        {pickLocale(ingredient.name, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>

        {related.length > 0 && (
          <section className="mt-16 border-t border-line pt-10">
            <h2 className="font-display text-2xl font-semibold text-forest-900">
              {t('knowledge.relatedArticles')}
            </h2>
            <ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((entry) => (
                <li key={entry.slug} className="flex">
                  <ArticleCardTile article={entry} className="w-full" />
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}
