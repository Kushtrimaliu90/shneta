import { getLocale, getTranslations } from 'next-intl/server';
import { Search, SearchX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { localizePath, pickLocale } from '@/lib/i18n';
import { buttonVariants } from '@/components/ui/button';
import { getCategoryTree } from '@/features/catalog/queries';
import type { Locale } from '@/lib/constants';

/**
 * docs/05 §16 — a 404 with a search box and the top categories, rather than a dead end.
 *
 * The form is a plain GET to `/search`, so it works with no JavaScript and reuses the results
 * page rather than growing its own. `action` needs the locale prefix spelled out: this is a
 * bare `<form>`, not next-intl's `Link`, so nothing rewrites the path for it.
 *
 * Categories come from the same cached tree the mega menu reads. A 404 is not a reason to skip
 * the cache, and it is a page a crawler hits often.
 */
export default async function NotFound() {
  const [t, tSearch, tShop, locale, categories] = await Promise.all([
    getTranslations('notFound'),
    getTranslations('search'),
    getTranslations('shop'),
    getLocale(),
    getCategoryTree(),
  ]);

  const top = categories.slice(0, 6);

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <SearchX className="size-10 text-carbon-500" aria-hidden="true" />
      <h1 className="mt-6 font-display text-3xl font-semibold text-carbon-900">{t('title')}</h1>
      <p className="mt-3 max-w-md text-ink-600">{t('body')}</p>

      <form
        action={localizePath('/search', locale as Locale)}
        role="search"
        className="mt-8 flex w-full max-w-md items-center gap-2"
      >
        <label htmlFor="notfound-search" className="sr-only">
          {tSearch('label')}
        </label>
        <input
          id="notfound-search"
          name="q"
          type="search"
          placeholder={tSearch('placeholder')}
          className="h-11 flex-1 rounded-sm border border-line-strong bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-500"
        />
        <button type="submit" className={buttonVariants()}>
          <Search className="size-4" aria-hidden="true" />
          {tSearch('submit')}
        </button>
      </form>

      {top.length > 0 && (
        <nav aria-label={tShop('categories')} className="mt-8 flex flex-wrap justify-center gap-2">
          {top.map((category) => (
            <Link
              key={category.slug}
              href={`/shop/${category.slug}`}
              className="inline-flex rounded-sm border border-line bg-surface px-3 py-1.5 text-sm text-ink-900 hover:bg-carbon-50"
            >
              {pickLocale(category.name, locale as Locale)}
            </Link>
          ))}
        </nav>
      )}

      <Link href="/" className={`${buttonVariants({ variant: 'link' })} mt-6`}>
        {t('cta')}
      </Link>
    </div>
  );
}
