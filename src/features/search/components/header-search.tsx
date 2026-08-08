'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, Loader2, Search, X } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { ProductImage } from '@/components/storefront/product-image';
import {
  logSearch,
  logSearchClick,
  searchQuick,
  type QuickResults,
} from '@/features/search/actions';
import { MIN_QUERY_LENGTH } from '@/features/search/constants';
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
} from '@/features/search/recent';
import { cn } from '@/lib/utils';

/**
 * The always-visible header search.
 *
 * Search is primary navigation on a marketplace, so this replaces the magnifier that opened an
 * overlay. The engine behind it already existed — `search_suggest` returns products, query
 * completions, brands, categories, ingredients, Knowledge articles and a spelling correction in one
 * round trip, over an index that is diacritic-insensitive and carries fifty synonym groups. What was
 * missing was a field you can see.
 *
 * ── Combobox semantics, done properly ──
 *
 * `role="combobox"` on the **input**, not on a wrapper: the pattern requires the role to sit on the
 * focusable control. Focus never leaves that input — arrow keys move `aria-activedescendant` between
 * option ids while the caret stays put, which is what lets a screen reader announce the option
 * without the browser scrolling focus away from the text being typed.
 *
 * ── One flat list behind the visual groups ──
 *
 * The dropdown *looks* like five sections; `flat` is the single ordered array those sections render
 * from. Arrow-key navigation, Enter and `aria-activedescendant` all index into it, so keyboard order
 * and visual order cannot drift — which they would if each group tracked its own cursor.
 */

type Option =
  | { kind: 'recent'; label: string }
  | { kind: 'term'; label: string }
  | { kind: 'product'; label: string; href: string; id: string; position: number }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'all'; label: string; href: string };

export function HeaderSearch({
  placeholders,
  className,
}: {
  /** Rotating examples, already localised. Editable from `/admin/search`. */
  placeholders: string[];
  className?: string;
}) {
  const t = useTranslations('search');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<QuickResults | null>(null);
  const [failed, setFailed] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [rotation, setRotation] = useState(0);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = useRef('');

  const trimmed = query.trim();
  const short = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;

  /* Recent searches live in a cookie and are read after mount — see `recent.ts` for why. */
  useEffect(() => setRecent(readRecentSearches()), []);

  /**
   * Rotating placeholders, to teach catalogue breadth.
   *
   * Paused while the field has focus or content — changing the hint under someone who is mid-thought
   * is a distraction rather than a nudge — and switched off entirely under reduced motion, where a
   * text swap every four seconds is exactly the kind of unrequested movement that setting is for.
   */
  useEffect(() => {
    if (placeholders.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (open || trimmed) return;

    const timer = window.setInterval(() => {
      setRotation((current) => (current + 1) % placeholders.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [placeholders.length, open, trimmed]);

  /* Debounced fetch, with a stale-response guard: a slow "vit" must not overwrite a fast "vitamin". */
  useEffect(() => {
    latest.current = trimmed;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setFailed(false);
      return;
    }

    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const next = await searchQuick(trimmed, locale);
          if (latest.current !== trimmed) return;
          setResults(next);
          setFailed(false);
        } catch {
          if (latest.current === trimmed) setFailed(true);
        }
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [trimmed, locale]);

  /* "/" focuses search from anywhere, unless the visitor is already typing into something. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Outside click closes. Pointerdown rather than click, so it fires before a link navigates. */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const flat = useMemo<Option[]>(() => {
    if (!trimmed) {
      return recent.map((label) => ({ kind: 'recent' as const, label }));
    }
    if (!results) return [];

    const options: Option[] = [];
    results.terms.forEach((label) => options.push({ kind: 'term', label }));
    results.products.forEach((product, index) =>
      options.push({
        kind: 'product',
        label: pickLocale(product.name, locale),
        href: `/product/${product.slug}`,
        id: product.id,
        position: index + 1,
      }),
    );
    results.brands.forEach((brand) =>
      options.push({ kind: 'link', label: brand.name, href: `/brands/${brand.slug}` }),
    );
    results.categories.forEach((category) =>
      options.push({
        kind: 'link',
        label: pickLocale(category.name, locale),
        href: `/shop/${category.slug}`,
      }),
    );
    results.ingredients.forEach((ingredient) =>
      options.push({
        kind: 'link',
        label: pickLocale(ingredient.name, locale),
        href: `/ingredients/${ingredient.slug}`,
      }),
    );
    results.articles.forEach((article) =>
      options.push({
        kind: 'link',
        label: pickLocale(article.title, locale),
        href: `/knowledge/${article.slug}`,
      }),
    );
    options.push({
      kind: 'all',
      label: t('seeAll', { query: trimmed }),
      href: `/search?q=${encodeURIComponent(trimmed)}`,
    });
    return options;
  }, [trimmed, results, recent, locale, t]);

  useEffect(() => setCursor(-1), [flat.length]);

  const submit = useCallback(
    (value: string) => {
      const clean = value.trim();
      if (!clean) return;
      pushRecentSearch(clean);
      setRecent(readRecentSearches());
      setOpen(false);
      inputRef.current?.blur();
      router.push(`/search?q=${encodeURIComponent(clean)}`);
    },
    [router],
  );

  function choose(option: Option) {
    if (option.kind === 'recent' || option.kind === 'term') {
      setQuery(option.label);
      inputRef.current?.focus();
      return;
    }

    pushRecentSearch(trimmed);
    setRecent(readRecentSearches());
    setOpen(false);

    if (option.kind === 'product') {
      /*
       * A product opened straight from the dropdown is the search that never reaches `/search` and
       * would otherwise be invisible in the report: the shopper typed, saw it and left. Not awaited —
       * navigation is client-side, so both requests finish alongside it.
       */
      const total = results?.productTotal ?? 0;
      void (async () => {
        const eventId = await logSearch({ query: trimmed, locale, source: 'overlay', resultCount: total });
        if (eventId) await logSearchClick(eventId, option.id, option.position);
      })();
    }

    router.push(option.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'Enter') {
      const active = cursor >= 0 ? flat[cursor] : undefined;
      event.preventDefault();
      if (active) choose(active);
      else submit(query);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (flat.length === 0) return;

    event.preventDefault();
    setOpen(true);
    setCursor((current) => {
      const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
      // Wraps, so ArrowUp from the box lands on the last option — quicker than eleven ArrowDowns.
      return ((next % flat.length) + flat.length) % flat.length;
    });
  }

  const showPanel = open && (flat.length > 0 || short || failed || Boolean(results));
  const activeId = cursor >= 0 ? `${listId}-option-${cursor}` : undefined;
  const placeholder = placeholders[rotation] ?? placeholders[0] ?? t('placeholder');

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          {t('label')}
        </label>

        {/*
          The focus ring belongs to the **field**, not the input inside it.

          `globals.css` gives every `:focus-visible` element a three-layer box-shadow — a background
          halo, the forest focus colour, then `lime-400`. That is right for a button, and wrong here:
          the input sits inside a box that already has a border, so the ring was drawn *within* it and
          the result was a bright green rounded rectangle nested inside a grey one. Two frames around
          one control, and the loudest colour in the palette on the calmest element in the header.

          So the input's own ring is suppressed and the container takes it: one quiet ring around the
          whole field. `focus-within` rather than `has-[:focus-visible]` on purpose — a text input
          shows a caret and a keyboard user has to see which field it is in, so the indicator should
          appear for pointer focus too. A 2 px forest ring against cream clears the contrast bar; it
          is quieter than the global treatment, not absent.
        */}
        <div className="flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 transition-colors focus-within:border-forest-600 focus-within:ring-2 focus-within:ring-forest-600/25">
          <Search className="size-4 shrink-0 text-ink-500" aria-hidden="true" />
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={`${listId}-list`}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            /*
             * `text-base` on mobile is not a typographic choice — it is the fix for the zoom.
             *
             * iOS Safari zooms the page whenever a focused input's font-size is under 16 px, and
             * `text-sm` is 14. Tapping search magnified the viewport and the layout ran off both
             * edges, which is what "covers the sides" was. The other way to stop it is
             * `maximum-scale=1` in the viewport meta, and that fixes the symptom by disabling
             * pinch-zoom for everybody — a WCAG 1.4.4 failure traded for a styling preference. 16 px
             * on the phone, 14 back on the desktop where no browser zooms and the header is tighter.
             *
             * `focus-visible:shadow-none` is what actually removes the global triple ring; Tailwind
             * utilities sit in a later layer than the `base` rule that sets it.
             */
            className="h-full min-w-0 flex-1 bg-transparent text-base text-ink-900 placeholder:text-ink-500 focus:outline-none focus-visible:shadow-none focus-visible:outline-none lg:text-sm"
          />
          {pending && <Loader2 className="size-4 shrink-0 animate-spin text-ink-500" aria-hidden="true" />}
          {query && !pending && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label={t('clear')}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-500 hover:text-ink-900"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </form>

      {/* The count, announced rather than only drawn. */}
      <p aria-live="polite" className="sr-only">
        {results ? t('resultCount', { count: flat.length - 1 }) : ''}
      </p>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-md border border-line bg-surface shadow-lg">
          <ul id={`${listId}-list`} role="listbox" aria-label={t('label')} className="py-1.5">
            {short && <Note>{t('hint')}</Note>}
            {failed && <Note tone="error">{t('errorState')}</Note>}

            {!trimmed && recent.length > 0 && (
              <>
                <GroupLabel>
                  {t('recent')}
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecent([]);
                    }}
                    className="font-normal text-ink-500 underline underline-offset-2 hover:text-ink-900"
                  >
                    {t('clearRecent')}
                  </button>
                </GroupLabel>
                {flat.map((option, index) =>
                  option.kind !== 'recent' ? null : (
                    <Row
                      key={`recent-${option.label}`}
                      id={`${listId}-option-${index}`}
                      active={cursor === index}
                      onPick={() => choose(option)}
                      onHover={() => setCursor(index)}
                    >
                      <Clock className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                      <span className="truncate">{option.label}</span>
                    </Row>
                  ),
                )}
              </>
            )}

            {results && (
              <>
                {results.terms.length > 0 && <GroupLabel>{t('tabs.suggestions')}</GroupLabel>}
                {flat.map((option, index) =>
                  option.kind !== 'term' ? null : (
                    <Row
                      key={`term-${option.label}`}
                      id={`${listId}-option-${index}`}
                      active={cursor === index}
                      onPick={() => choose(option)}
                      onHover={() => setCursor(index)}
                    >
                      <Search className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                      <span className="truncate">{option.label}</span>
                    </Row>
                  ),
                )}

                {results.products.length > 0 && <GroupLabel>{t('tabs.products')}</GroupLabel>}
                {results.products.map((product, productIndex) => {
                  const index = flat.findIndex(
                    (option) => option.kind === 'product' && option.id === product.id,
                  );
                  const name = pickLocale(product.name, locale);
                  const descriptor =
                    product.form ?? pickLocale(product.subtitle, locale).split(/[.·—]/)[0]?.trim();

                  return (
                    <Row
                      key={product.slug}
                      id={`${listId}-option-${index}`}
                      active={cursor === index}
                      onPick={() => {
                        const option = flat[index];
                        if (option) choose(option);
                      }}
                      onHover={() => setCursor(index)}
                    >
                      <span className="size-9 shrink-0 overflow-hidden rounded-sm bg-cream">
                        <ProductImage
                          path={product.imagePath}
                          alt=""
                          sizes="36px"
                          priority={productIndex === 0}
                          className="size-9 p-0.5"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink-900">{name}</span>
                        <span className="block truncate text-xs text-ink-500">
                          {[product.brandName, descriptor].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-ink-900" data-numeric>
                        {formatPrice(product.priceCents, locale)}
                      </span>
                    </Row>
                  );
                })}

                <LinkGroup
                  label={t('tabs.brands')}
                  items={results.brands.map((b) => ({ label: b.name, href: `/brands/${b.slug}` }))}
                  {...{ flat, cursor, setCursor, choose, listId }}
                />
                <LinkGroup
                  label={t('tabs.categories')}
                  items={results.categories.map((c) => ({
                    label: pickLocale(c.name, locale),
                    href: `/shop/${c.slug}`,
                  }))}
                  {...{ flat, cursor, setCursor, choose, listId }}
                />
                <LinkGroup
                  label={t('tabs.ingredients')}
                  items={results.ingredients.map((i) => ({
                    label: pickLocale(i.name, locale),
                    href: `/ingredients/${i.slug}`,
                  }))}
                  {...{ flat, cursor, setCursor, choose, listId }}
                />
                <LinkGroup
                  label={t('tabs.knowledge')}
                  items={results.articles.map((a) => ({
                    label: pickLocale(a.title, locale),
                    href: `/knowledge/${a.slug}`,
                  }))}
                  {...{ flat, cursor, setCursor, choose, listId }}
                />

                {/*
                  Never a dead end. A query with nothing behind it offers the spelling correction and
                  a route into the catalogue, because "no results" plus a blank panel is the moment a
                  shopper decides the shop does not stock what they want.
                */}
                {flat.length <= 1 && (
                  <>
                    <Note>{t('noResults', { query: trimmed })}</Note>
                    {results.didYouMean && (
                      <Row
                        id={`${listId}-suggestion`}
                        active={false}
                        onPick={() => setQuery(results.didYouMean ?? '')}
                        onHover={() => undefined}
                      >
                        <span className="text-forest-800 underline underline-offset-4">
                          {t('didYouMeanShort', { query: results.didYouMean })}
                        </span>
                      </Row>
                    )}
                  </>
                )}

                {(() => {
                  const index = flat.findIndex((option) => option.kind === 'all');
                  const option = index >= 0 ? flat[index] : undefined;
                  if (!option) return null;
                  return (
                    <Row
                      id={`${listId}-option-${index}`}
                      active={cursor === index}
                      onPick={() => choose(option)}
                      onHover={() => setCursor(index)}
                    >
                      <span className="w-full border-t border-line pt-2 text-sm font-medium text-forest-800">
                        {option.label}
                      </span>
                    </Row>
                  );
                })()}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  /*
   * `presentation`, because a heading between options would otherwise be announced as one. The
   * grouping is visual; the flat list is what the keyboard and the screen reader traverse.
   */
  return (
    <li
      role="presentation"
      className="flex items-center justify-between px-3 pt-2 pb-1 font-ui text-[11px] font-semibold tracking-wide text-ink-500 uppercase"
    >
      {children}
    </li>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <li role="presentation" className={cn('px-3 py-2 text-sm', tone === 'error' ? 'text-error' : 'text-ink-600')}>
      {children}
    </li>
  );
}

function Row({
  id,
  active,
  onPick,
  onHover,
  children,
}: {
  id: string;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    /*
      No key handler on the option, and none is needed: every key that operates this list is caught
      on the input, where focus stays. The row responds to the pointer; the keyboard talks to the
      combobox. That is the pattern, and it is why aria-activedescendant exists.
    */
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(event) => {
        // Before blur, or the panel closes and the click lands on whatever is underneath.
        event.preventDefault();
        onPick();
      }}
      onMouseEnter={onHover}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
        active ? 'bg-forest-50' : 'hover:bg-forest-50/60',
      )}
    >
      {children}
    </li>
  );
}

function LinkGroup({
  label,
  items,
  flat,
  cursor,
  setCursor,
  choose,
  listId,
}: {
  label: string;
  items: { label: string; href: string }[];
  flat: Option[];
  cursor: number;
  setCursor: (index: number) => void;
  choose: (option: Option) => void;
  listId: string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <GroupLabel>{label}</GroupLabel>
      {items.map((item) => {
        const index = flat.findIndex(
          (option) => option.kind === 'link' && option.href === item.href,
        );
        const option = index >= 0 ? flat[index] : undefined;
        if (!option) return null;

        return (
          <Row
            key={item.href}
            id={`${listId}-option-${index}`}
            active={cursor === index}
            onPick={() => choose(option)}
            onHover={() => setCursor(index)}
          >
            <span className="truncate">{item.label}</span>
          </Row>
        );
      })}
    </>
  );
}
