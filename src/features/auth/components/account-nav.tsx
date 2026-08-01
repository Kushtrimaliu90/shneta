'use client';

import { useTranslations } from 'next-intl';
import {
  Heart,
  LayoutDashboard,
  MapPin,
  Package,
  Repeat,
  Settings,
  Star,
  Ticket,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * docs/05 §14 — side nav on desktop, horizontally scrolling tabs on mobile.
 *
 * `milestone` marks sections whose pages do not exist yet. They are rendered as disabled
 * rather than omitted, so the account area shows its real shape from the start — but they
 * are not links, because a nav full of 404s is worse than an honest "coming with M5".
 */
interface AccountNavItem {
  key:
    | 'overview'
    | 'orders'
    | 'subscriptions'
    | 'addresses'
    | 'wishlist'
    | 'reviews'
    | 'loyalty'
    | 'settings';
  href: string;
  icon: LucideIcon;
  milestone?: string;
}

const ITEMS: readonly AccountNavItem[] = [
  { key: 'overview', href: '/account', icon: LayoutDashboard },
  { key: 'orders', href: '/account/orders', icon: Package },
  { key: 'subscriptions', href: '/account/subscriptions', icon: Repeat },
  { key: 'addresses', href: '/account/addresses', icon: MapPin, milestone: 'M5' },
  { key: 'wishlist', href: '/account/wishlist', icon: Heart },
  { key: 'reviews', href: '/account/reviews', icon: Star },
  { key: 'loyalty', href: '/account/loyalty', icon: Ticket },
  { key: 'settings', href: '/account/settings', icon: Settings },
];

export function AccountNav() {
  const pathname = usePathname();
  const t = useTranslations('account.nav');

  return (
    <nav aria-label={t('label')} className="lg:w-56 lg:shrink-0">
      <ul className="-mx-5 flex gap-1 overflow-x-auto border-b border-line px-5 pb-3 lg:mx-0 lg:flex-col lg:border-0 lg:px-0 lg:pb-0">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const label = t(item.key);

          if (item.milestone) {
            return (
              <li key={item.key}>
                <span
                  aria-disabled="true"
                  title={`${label} — ${item.milestone}`}
                  className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap text-ink-400"
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                  <span className="ml-auto hidden rounded-sm border border-line px-1.5 py-0.5 font-ui text-[11px] lg:inline">
                    {item.milestone}
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-forest-100 font-medium text-forest-900'
                    : 'text-ink-600 hover:bg-forest-50 hover:text-forest-800',
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
