'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/admin/settings', label: 'Shop' },
  { href: '/admin/settings/shipping', label: 'Shipping' },
  { href: '/admin/settings/team', label: 'Team' },
  { href: '/admin/settings/audit', label: 'Audit log' },
];

/**
 * The settings sub-navigation.
 *
 * A client component only because it needs `usePathname` to mark the current tab. The pages it
 * links to are all Server Components; this is a strip of links, not a router.
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="mt-5 flex flex-wrap gap-1.5 border-b border-line pb-3">
      {TABS.map((tab) => {
        // Exact match for the index, prefix for the rest — otherwise "Shop" is active everywhere.
        const active = tab.href === '/admin/settings' ? pathname === tab.href : pathname.startsWith(tab.href);
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
