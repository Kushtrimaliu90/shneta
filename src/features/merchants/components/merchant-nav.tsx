'use client';

import { useTranslations } from 'next-intl';
import { FileText, LayoutDashboard, Package, Settings, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * docs/16 §5 — portal nav. Side rail on desktop, scrolling tabs on mobile, as `/account` is.
 *
 * `needsApproval` marks the sections that only mean something once the merchant is live. They are
 * rendered as disabled rather than hidden, because a pending merchant asking "where do I add
 * products?" is better served by seeing the section greyed out with a reason than by a nav that
 * grows after an event they cannot observe.
 *
 * Documents is deliberately **always** enabled: uploading the registration certificate is the one
 * thing a pending merchant must be able to do, and it is what unblocks their own approval.
 */
interface Item {
  key: 'overview' | 'orders' | 'offers' | 'documents' | 'settings';
  href: string;
  icon: LucideIcon;
  needsApproval?: boolean;
}

const ITEMS: readonly Item[] = [
  { key: 'overview', href: '/merchant', icon: LayoutDashboard },
  { key: 'orders', href: '/merchant/orders', icon: Truck, needsApproval: true },
  { key: 'offers', href: '/merchant/offers', icon: Package, needsApproval: true },
  { key: 'documents', href: '/merchant/documents', icon: FileText },
  { key: 'settings', href: '/merchant/settings', icon: Settings },
];

export function MerchantNav({ approved }: { approved: boolean }) {
  const pathname = usePathname();
  const t = useTranslations('merchant.portal.nav');

  return (
    <nav aria-label={t('label')} className="lg:w-56 lg:shrink-0">
      <ul className="-mx-5 flex gap-1 overflow-x-auto border-b border-line px-5 pb-3 lg:mx-0 lg:flex-col lg:border-0 lg:px-0 lg:pb-0">
        {ITEMS.map((item) => {
          const label = t(item.key);
          const locked = Boolean(item.needsApproval) && !approved;
          // `/merchant/offers/new` should keep the Offers tab marked current.
          const isActive =
            item.href === '/merchant' ? pathname === item.href : pathname.startsWith(item.href);

          if (locked) {
            return (
              <li key={item.key}>
                <span
                  aria-disabled="true"
                  title={t('lockedHint')}
                  className="flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap text-ink-400"
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
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
