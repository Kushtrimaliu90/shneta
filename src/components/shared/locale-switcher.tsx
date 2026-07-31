'use client';

import type { MouseEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { LOCALES, type Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * docs/05 §17 — switches locale while staying on the current page.
 *
 * Rendered as two real links (not a `<select>`) so both locales are crawlable, carry the
 * hreflang relationship, and work with JavaScript disabled.
 *
 * Query preservation is done at click time from `window.location.search` rather than with
 * `useSearchParams`, which would opt the whole page out of static rendering and break the
 * ISR strategy in docs/02 §5. The consequence is a clean, cacheable `href` in the HTML —
 * which is also the correct thing for a crawler to follow — plus filters that survive the
 * switch for anyone with JavaScript (docs/05 §2: PLP filters live in the query string).
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('locale');

  function switchTo(locale: Locale) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      // Let the browser handle modified clicks (new tab, download, …) natively.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;

      const search = window.location.search;
      if (!search) return; // Nothing to preserve — the plain href is already correct.

      event.preventDefault();
      const query = Object.fromEntries(new URLSearchParams(search).entries());
      router.replace({ pathname, query }, { locale });
    };
  }

  return (
    <div
      className={cn('flex items-center gap-0.5 rounded-sm p-0.5', className)}
      role="group"
      aria-label={t('label')}
    >
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            hrefLang={locale}
            onClick={switchTo(locale)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'rounded-sm px-2 py-1 font-ui text-xs font-semibold uppercase transition-colors',
              isActive
                ? 'bg-forest-100 text-forest-900'
                : 'text-ink-500 hover:bg-forest-50 hover:text-forest-800',
            )}
          >
            {locale}
            {/*
              WCAG 2.1 SC 2.5.3 (Label in Name): the accessible name must *contain* the
              visible label. An `aria-label` of "Switch to Albanian" replaces the visible
              "sq" outright, so a speech-input user saying "click sq" would hit nothing.
              Extending the name with visually hidden text keeps both. axe does not flag
              this — it is only caught by reading the accessible name against the label.
            */}
            {!isActive && (
              <span className="sr-only"> — {t('switchTo', { language: t(locale) })}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
