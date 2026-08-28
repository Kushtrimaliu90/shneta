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

  /*
   * `about` is the story page; everything else this component renders is legal text. The
   * distinction drives the two per-slug touches below — a date on the legal pages, a stand-first
   * on the story — without splitting the component back into near-identical route files.
   */
  const isLegal = slug !== 'about';

  /*
   * The prose tier. These four pages are pure reading, and a reading measure does not get wider
   * because the monitor did — they opt out of the wide tier rather than inheriting it. The
   * `max-w-3xl` that used to sit on the article did the same job by hand; the token replaces it so
   * there is one definition of "a line of body copy is this long" instead of one per page.
   */
  return (
    <div className="container-text py-8 lg:py-12">
      <article>
        <h1 className="font-display text-3xl font-semibold text-forest-900 lg:text-display-md">
          {pickLocale(page.title, locale)}
        </h1>

        {/*
          A visible "last updated" date, because the legal pages are where it matters: a terms
          or privacy page with no date gives a reader no way to know whether what they agreed to
          has changed. On the story page the same line said "this copy was touched in the CMS on
          {date}" — bureaucratic warmth-killer, carrying no information a reader can use — so
          only the legal slugs render it.
        */}
        {isLegal && (
          <p className="mt-2 text-sm text-ink-500" data-numeric>
            {t('lastUpdated', { date: new Date(page.updatedAt).toLocaleDateString(locale) })}
          </p>
        )}

        <div className="mt-8">
          <MarkdownBody
            markdown={pickLocale(page.body, locale)}
            /*
              The story opens with a stand-first: its first paragraph a step up in size, the way
              an editorial page introduces itself. Only the about page — a terms document opening
              with a flourish would read as satire.
            */
            className={isLegal ? undefined : '[&>p:first-of-type]:text-lg'}
          />
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
