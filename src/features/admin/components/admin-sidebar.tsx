'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from '@/features/admin/components/nav-icon';
import type { NavSection } from '@/features/admin/roles';
import { cn } from '@/lib/utils';

/**
 * The role-filtered sidebar (docs/06 preamble).
 *
 * A client component only because it needs `usePathname` to mark the current section. The
 * filtering itself happened on the server in `visibleNav` — a role must never be able to
 * learn what it cannot reach by reading the markup of what was hidden from it.
 *
 * Hidden below `lg`, where the topbar's drawer takes over. Two renderings of one nav is worth
 * it here: a persistent 15rem rail is the right shape for an operator on a desk all day, and
 * a drawer is the right shape on a phone in a warehouse.
 */
export function AdminSidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();

  return (
    <aside className="hidden border-r border-line bg-surface lg:block">
      <div className="sticky top-0 flex h-screen flex-col">
        <Link
          href="/admin"
          className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-5 font-display text-lg font-semibold text-carbon-900"
        >
          BIOCODE
          <span className="rounded-sm bg-carbon-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold tracking-wide text-carbon-900 uppercase">
            Admin
          </span>
        </Link>

        <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.heading} className="mb-5">
              <h2 className="px-2 pb-1.5 font-ui text-[11px] font-semibold tracking-[0.08em] text-ink-500 uppercase">
                {section.heading}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  /*
                   * `/admin` would otherwise match every child route, so the dashboard is
                   * compared exactly while the rest match their subtree — an order detail page
                   * should still light up "Orders".
                   */
                  const active =
                    item.href === '/admin'
                      ? pathname === '/admin'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex min-h-10 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
                          active
                            ? 'bg-carbon-100 font-medium text-carbon-900'
                            : 'text-ink-600 hover:bg-carbon-50 hover:text-carbon-800',
                        )}
                      >
                        <NavIcon name={item.icon} className="size-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
