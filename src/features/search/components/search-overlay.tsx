'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Search, X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import { searchQuick, type QuickResults } from '@/features/search/actions';
import { MIN_QUERY_LENGTH } from '@/features/search/constants';
import { cn } from '@/lib/utils';

/**
 * docs/05 §8 — the instant search overlay behind the navbar's magnifier.
 *
 * Debounced at 250 ms as specified. The debounce is not a nicety: without it every keystroke is
 * a server action, and a six-letter word is six full-text queries of which five are thrown away.
 *
 * A stale response can arrive after a newer one — type "vit", then "vitamin", and the slower
 * "vit" request lands last and replaces the right answer with the wrong one. `latest` guards
 * that: each request records the query it was for, and a response for anything other than what
 * is currently in the box is dropped.
 */
export function SearchOverlay() {
  const t = useTranslations('search');
  const locale = useLocale() as Locale;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<QuickResults | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef('');

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes from anywhere in the panel, which is what a dialog-like overlay owes a
  // keyboard user.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    latest.current = trimmed;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      return;
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        const next = await searchQuick(trimmed);
        if (latest.current === trimmed) setResults(next);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [query, open]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    // docs/05 §8 — an empty query goes to the shop rather than an empty results page.
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/shop');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('open')}
        className="inline-flex size-11 items-center justify-center rounded-md text-carbon-800 transition-colors hover:bg-carbon-50"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('close')}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 cursor-default bg-ink-900/20"
      />

      <div className="fixed inset-x-0 top-0 z-50 border-b border-line bg-bone shadow-lg">
        <div className="container-page py-4">
          <form onSubmit={submit} role="search" className="flex items-center gap-2">
            <Search className="size-5 shrink-0 text-ink-500" aria-hidden="true" />
            <label htmlFor="site-search" className="sr-only">
              {t('label')}
            </label>
            <input
              ref={inputRef}
              id="site-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('placeholder')}
              className="h-11 flex-1 bg-transparent text-base text-ink-900 placeholder:text-ink-500 focus:outline-none"
            />
            {pending && <Loader2 className="size-4 animate-spin text-ink-500" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="inline-flex size-9 items-center justify-center rounded-md text-ink-600 hover:bg-carbon-50"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </form>

          {/*
            `aria-live="polite"` so a screen-reader user hears that results arrived. Without it
            the overlay silently fills with links below a box they are still typing in.
          */}
          <div aria-live="polite" className="mt-3 max-h-[60vh] overflow-y-auto">
            {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
              <p className="py-2 text-sm text-ink-600">{t('hint')}</p>
            )}

            {results && results.products.length === 0 && results.ingredients.length === 0 && (
              <p className="py-2 text-sm text-ink-600">{t('noResults', { query: query.trim() })}</p>
            )}

            {results && results.products.length > 0 && (
              <section>
                <h2 className="eyebrow">{t('tabs.products')}</h2>
                <ul className="mt-1.5 flex flex-col">
                  {results.products.map((product) => {
                    const name = pickLocale(product.name, locale);
                    return (
                      <li key={product.slug}>
                        <Link
                          href={`/product/${product.slug}`}
                          onClick={() => setOpen(false)}
                          className="flex items-center gap-3 rounded-md p-2 hover:bg-carbon-50"
                        >
                          <div className="size-10 shrink-0 overflow-hidden rounded-sm bg-bone">
                            <ProductImage
                              path={product.imagePath}
                              alt={name}
                              sizes="40px"
                              className="size-10 p-1"
                            />
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink-900">{name}</span>
                            <span className="block text-xs text-ink-500">{product.brandName}</span>
                          </span>
                          <span className="shrink-0 text-sm text-ink-900" data-numeric>
                            {formatPrice(product.priceCents, locale)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {results && results.ingredients.length > 0 && (
              <section className="mt-3">
                <h2 className="eyebrow">{t('tabs.ingredients')}</h2>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {results.ingredients.map((ingredient) => (
                    <li key={ingredient.slug}>
                      <Link
                        href={`/ingredients/${ingredient.slug}`}
                        onClick={() => setOpen(false)}
                        className="inline-flex rounded-sm border border-line px-2.5 py-1 text-sm text-ink-900 hover:bg-carbon-50"
                      >
                        {pickLocale(ingredient.name, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {results && results.productTotal > results.products.length && (
              <Link
                href={`/search?q=${encodeURIComponent(query.trim())}`}
                onClick={() => setOpen(false)}
                className={cn(
                  'mt-3 inline-block rounded-sm text-sm font-medium text-carbon-800 underline underline-offset-4',
                )}
              >
                {t('seeAll', { query: query.trim() })}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
