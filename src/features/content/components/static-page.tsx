import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { resolveLocale } from '@/i18n/locale';
import { pickLocale } from '@/lib/i18n';
import { getPage } from '@/features/content/queries';
import { MarkdownBody } from '@/features/content/components/markdown-body';
import type { Locale } from '@/lib/constants';

/**
 * docs/05 §16 — `/about` and the three legal pages, all rendered from the `pages` table.
 *
 * One component because the four differ only in their slug: the copy is editable content, not
 * code, and four near-identical route files would be four places to forget the markdown
 * sanitiser or the "last updated" line.
 */
export async function StaticPageBody({
  slug,
  locale: rawLocale,
}: {
  slug: string;
  locale: string;
}) {
  const locale = resolveLocale(rawLocale) as Locale;
  setRequestLocale(locale);

  const [page, t] = await Promise.all([getPage(slug), getTranslations('legal')]);
  if (!page) notFound();

  return (
    <div className="container-page py-8 lg:py-12">
      <article className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold text-carbon-900 lg:text-4xl">
          {pickLocale(page.title, locale)}
        </h1>

        {/*
          A visible "last updated" date, because these are the pages where it matters: a terms
          or privacy page with no date gives a reader no way to know whether what they agreed to
          has changed.
        */}
        <p className="mt-2 text-sm text-ink-500" data-numeric>
          {t('lastUpdated', { date: page.updatedAt.slice(0, 10) })}
        </p>

        <div className="mt-8">
          <MarkdownBody markdown={pickLocale(page.body, locale)} />
        </div>
      </article>
    </div>
  );
}

/** Shared metadata for the same four pages. */
export async function staticPageMetadata(slug: string, rawLocale: string) {
  const locale = resolveLocale(rawLocale);
  const page = await getPage(slug);
  if (!page) return {};

  const title = pickLocale(page.seoTitle, locale) || pickLocale(page.title, locale);

  return {
    title,
    description: pickLocale(page.seoDescription, locale) || undefined,
    alternates: {
      canonical: `/${slug === 'about' ? 'about' : `legal/${slug}`}`,
      languages: {
        sq: `/${slug === 'about' ? 'about' : `legal/${slug}`}`,
        en: `/en/${slug === 'about' ? 'about' : `legal/${slug}`}`,
      },
    },
  };
}
