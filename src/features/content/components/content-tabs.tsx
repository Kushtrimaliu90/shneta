'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin/content', label: 'Articles' },
  { href: '/admin/content/pages', label: 'Pages' },
  { href: '/admin/content/faqs', label: 'FAQs' },
  { href: '/admin/content/banners', label: 'Banners' },
];

/** docs/06 §13 — the content sub-navigation. A strip of links, marked by `usePathname`. */
export function ContentTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Content sections"
      className="mt-5 flex flex-wrap gap-1.5 border-b border-line pb-3"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/admin/content'
            ? pathname === tab.href || pathname.startsWith('/admin/content/articles')
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 items-center rounded-sm border px-3 text-sm transition-colors',
              active
                ? 'border-carbon-800 bg-carbon-100 font-medium text-carbon-900'
                : 'border-line-strong text-ink-600 hover:bg-carbon-50',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
