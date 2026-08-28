'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n';
import { storageUrl } from '@/lib/storage';
import type { Locale } from '@/lib/constants';
import { isActiveNavPath, type NavLink } from '@/components/storefront/nav-links';
import type { CategoryTile } from '@/features/catalog/queries';
import { cn } from '@/lib/utils';

/**
 * The desktop link list, as a client island (docs/04 §6).
 *
 * Client because of two things a server render cannot know: **which link is current** and
 * **whether the Shop menu is open**. `usePathname` here is a client hook reading the router —
 * it does not opt any page out of static rendering, so the header's "nothing request-scoped"
 * contract (see `navbar.tsx`) stays true; that contract is about server APIs (`cookies()`,
 * `headers()`), not about hydration.
 *
 * Active state is docs/04 §3's reserved use of `forest-700` ("links, active nav"), matched on
 * the **first path segment** so `/shop/vitamins` lights Shop and `/knowledge/some-article`
 * lights Knowledge. `aria-current="page"` carries the same answer to assistive tech.
 */

/** `HEADER_NAV`'s element type: the shared set, with BioHack swapped in (see navbar.tsx). */
export interface HeaderNavLink {
  key: NavLink['key'] | 'biohack';
  href: string;
}

const ITEM_CLASSES =
  'inline-flex h-11 items-center gap-1 rounded-md px-3 text-[15px] font-medium transition-colors';
const IDLE_CLASSES = 'text-ink-900 hover:bg-forest-50 hover:text-forest-800';
/** The persistent pill: the hover treatment, kept (docs/04 §3 — forest-700 is active nav). */
const ACTIVE_CLASSES = 'bg-forest-50 text-forest-700';

/** ~150ms of hover intent, so skimming the bar towards search does not strobe the panel. */
const HOVER_INTENT_MS = 150;

export function DesktopNav({
  links,
  categories,
}: {
  links: readonly HeaderNavLink[];
  categories: CategoryTile[];
}) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <ul className="flex items-center gap-1">
      {links.map((link) => {
        const active = isActiveNavPath(pathname, link.href);

        /* No categories — an emptied taxonomy — degrades Shop to the plain link, not an empty panel. */
        if (link.key === 'shop' && categories.length > 0) {
          return (
            <ShopMenuItem
              key={link.key}
              href={link.href}
              label={t('nav.shop')}
              active={active}
              categories={categories}
            />
          );
        }

        return (
          <li key={link.key}>
            <Link
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(ITEM_CLASSES, active ? ACTIVE_CLASSES : IDLE_CLASSES)}
            >
              {t(`nav.${link.key}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * docs/04 §6 — the Shop mega menu: a disclosure under the header with four columns of category
 * links and a promo tile.
 *
 * ── Positioning: `absolute` against the header, never `fixed` ──
 *
 * The panel is `absolute inset-x-0 top-full`, resolved against the sticky header (sticky is a
 * positioned ancestor), so it spans the header's full width and rides with it. Nothing here may
 * ever add `transform`/`filter`/`backdrop-blur`/`will-change` **to the header itself** — that
 * turns the header into a containing block for the two `fixed inset-0` overlays it mounts, the
 * trap `navbar.tsx` documents and `e2e/shell.spec.ts` fails on.
 *
 * ── Motion ──
 *
 * CSS only — a fade/translate through `@starting-style`, the `MobileBuyBar` idiom. Framer stays
 * off the header's critical path (docs/13 §E), whatever docs/04 §8's variant list once assumed;
 * the docs/13 entry for this menu records that.
 *
 * ── Interactions ──
 *
 * Click toggles (an `aria-expanded` anchor to /shop, so an un-hydrated or no-JS click still
 * navigates); hover opens after ~150ms of intent and a symmetric close delay lets the pointer
 * cross the strip of header between the trigger and the panel's top edge without the panel
 * vanishing mid-journey. Esc closes, returning focus to the trigger only when focus was inside
 * the region; focus leaving the region closes; an outside click closes; a route change closes.
 */
function ShopMenuItem({
  href,
  label,
  active,
  categories,
}: {
  href: string;
  label: string;
  active: boolean;
  categories: CategoryTile[];
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLLIElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Stable — it touches refs only — so the hover effect below can list it honestly. */
  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  /* Navigating anywhere — a panel link, a nav link, back/forward — dismisses the panel. */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /*
   * Hover intent, wired as DOM listeners rather than JSX props: an `<li>` with mouse handlers
   * trips jsx-a11y's non-interactive-element rule, and rightly — hover here is an *enhancement*
   * over the click path, not the interaction itself. `mouseenter`/`mouseleave` count descendants
   * as inside, so the symmetric close delay only has to cover the strip of header between the
   * trigger's bottom edge and the panel's top edge.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onEnter = () => {
      clearTimers();
      openTimer.current = setTimeout(() => setOpen(true), HOVER_INTENT_MS);
    };
    const onLeave = () => {
      clearTimers();
      closeTimer.current = setTimeout(() => {
        /*
         * A pointer that merely crossed the header must not unmount a panel a keyboard user
         * is inside: closing would drop their focus to <body>. Focus inside the region keeps
         * the panel; the focusout dismissal takes over the moment they tab away.
         */
        if (rootRef.current?.contains(document.activeElement)) return;
        setOpen(false);
      }, HOVER_INTENT_MS);
    };

    root.addEventListener('mouseenter', onEnter);
    root.addEventListener('mouseleave', onLeave);
    return () => {
      root.removeEventListener('mouseenter', onEnter);
      root.removeEventListener('mouseleave', onLeave);
      clearTimers();
    };
  }, [clearTimers]);

  /* The three dismissals that only exist while open: Esc, focus leaving the region, outside click. */
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      /*
       * Refocus the trigger only when focus is actually inside the region. Hover intent opens
       * the panel without moving focus, so the user may be mid-keystroke somewhere else —
       * most plausibly the header search, whose own Escape handler this listener runs after.
       * Yanking their focus to the Shop trigger would turn a dismissal into a hijack.
       */
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    }
    /* Tabbing out of the trigger-plus-panel region is a dismissal too. */
    function onFocusOut(event: FocusEvent) {
      if (!root?.contains(event.relatedTarget as Node)) setOpen(false);
    }
    /* `pointerdown` rather than `click`, so it wins against drags. */
    function onPointerDown(event: PointerEvent) {
      if (root && !root.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    root?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      root?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  return (
    <li ref={rootRef}>
      {/*
        A real link, progressively enhanced into a disclosure — not a <button>. The old header
        rendered Shop as an anchor in the server HTML, and this codebase treats pre-hydration
        operability as a contract (buy-box.tsx, action-form.tsx, commits e3b2309/ab83cc1). A
        button whose only behaviour is a client onClick would make the most-clicked nav item a
        dead pixel until the bundle lands, and permanently without JavaScript. As an anchor, an
        un-hydrated click falls through to normal navigation to /shop; once hydrated, onClick
        prevents that and toggles the panel instead — same as before, minus the dead window.
      */}
      <Link
        ref={triggerRef}
        href={href}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(event) => {
          event.preventDefault();
          clearTimers();
          setOpen((previous) => !previous);
        }}
        aria-current={active ? 'page' : undefined}
        className={cn(ITEM_CLASSES, active || open ? ACTIVE_CLASSES : IDLE_CLASSES)}
      >
        {label}
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </Link>

      {open && (
        <div
          id={panelId}
          /* A labelled region, not a bare div: `aria-label` is prohibited on a generic role. */
          role="region"
          aria-label={t('nav.shopMenu')}
          className={cn(
            'absolute inset-x-0 top-full border-b border-line bg-surface shadow-lg',
            /* The docs/04 §8 fade/translate, via @starting-style — no mount library. */
            'motion-safe:transition-[opacity,translate] motion-safe:duration-[var(--duration-ui)] motion-safe:ease-[var(--ease-biocode)]',
            'starting:opacity-0 motion-safe:starting:-translate-y-2',
          )}
        >
          <div className="container-wide grid grid-cols-[minmax(0,1fr)_16rem] gap-10 py-8">
            <div className="min-w-0">
              {/* Four columns of category links — the same tiles the homepage row draws from. */}
              <ul className="grid grid-cols-4 gap-x-6 gap-y-1">
                {categories.map((tile) => {
                  /* Bucket follows the flag — see `CategoryTile.imageIsCurated`. */
                  const image = tile.imagePath
                    ? storageUrl(
                        tile.imageIsCurated ? 'brand-assets' : 'product-images',
                        tile.imagePath,
                      )
                    : null;

                  return (
                    <li key={tile.slug}>
                      <Link
                        href={`/shop/${tile.slug}`}
                        className="group/item flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-forest-50"
                      >
                        <span
                          className={cn(
                            /* White behind a photograph, tinted behind nothing — see category-row.tsx. */
                            'relative size-10 shrink-0 overflow-hidden rounded-full',
                            image ? 'bg-white ring-1 ring-line' : 'bg-forest-50',
                          )}
                        >
                          {image ? (
                            <Image
                              src={image}
                              alt=""
                              fill
                              /* A 40px disc at every breakpoint; the default would fetch 640px. */
                              sizes="40px"
                              className="object-contain p-1"
                            />
                          ) : (
                            <span className="absolute inset-0 bg-gradient-to-br from-forest-100 to-lime-500/20" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-forest-900 group-hover/item:text-forest-700">
                            {pickLocale(tile.name, locale)}
                          </span>
                          <span className="block font-ui text-[12px] text-ink-500" data-numeric>
                            {t('home.sections.categoryCount', { count: tile.productCount })}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* The route the trigger used to be: /shop is still one click away with a keyboard. */}
              <Link
                href={href}
                className="group/all mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800"
              >
                {t('home.sections.allProducts')}
                <ArrowRight
                  className="size-4 transition-transform group-hover/all:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </div>

            {/*
              The promo tile — static localized copy pointing at /offers rather than a
              banner-driven card; the docs/13 entry records the simplification. Forest tint,
              not lime: the accent budget is one per viewport (docs/04 §1).
            */}
            <Link
              href="/offers"
              className="group/promo flex flex-col justify-between gap-6 rounded-lg bg-forest-50 p-5 transition-colors hover:bg-forest-100"
            >
              <span>
                <span className="block eyebrow">{t('nav.offers')}</span>
                <span className="mt-2 block font-display text-lg font-medium text-forest-900">
                  {t('nav.mega.promoTitle')}
                </span>
                <span className="mt-1 block text-sm text-ink-600">{t('nav.mega.promoBody')}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-700">
                {t('nav.mega.promoCta')}
                <ArrowRight
                  className="size-4 transition-transform group-hover/promo:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
