'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import { adminSignOut } from '@/features/admin/actions';
import { SubmitButton } from '@/components/ui/submit-button';
import { NavIcon } from '@/features/admin/components/nav-icon';
import type { NavSection } from '@/features/admin/roles';
import { cn } from '@/lib/utils';

/**
 * The admin topbar: mobile nav drawer, environment badge, who you are signed in as.
 *
 * The environment badge is not decoration (docs/06 preamble). Staff will have production and a
 * preview open in adjacent tabs, and the panels are identical — the badge is the only thing
 * that stops someone cancelling a real order while they think they are testing. It shows on
 * anything that is not production, so a *missing* badge is the safe signal rather than the
 * dangerous one.
 */
export function AdminTopbar({
  name,
  email,
  role,
  sections,
}: {
  name: string;
  email: string;
  role: string;
  sections: NavSection[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on route change — otherwise tapping a link leaves the drawer over the new page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /*
   * `NEXT_PUBLIC_VERCEL_ENV` is 'production' | 'preview' | 'development' on Vercel and
   * undefined locally. Read inline rather than through `lib/env.client.ts` because it is
   * Vercel's own variable, not one this project declares, and it is legitimately absent.
   */
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const environment = vercelEnv === 'production' ? null : (vercelEnv ?? 'local');

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 lg:px-8">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open admin menu"
        className="inline-flex size-11 items-center justify-center rounded-md text-forest-800 hover:bg-forest-50 lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <Link
        href="/admin"
        className="font-display text-base font-semibold text-forest-900 lg:hidden"
      >
        BIOCODE Admin
      </Link>

      {environment && (
        /*
         * Solid fill, white text. The first version used `bg-warning/15` with `text-warning`,
         * which axe measured at 4.08:1 — a 15% tint over cream resolves to #f4e5da, and the
         * amber on that misses AA. White on solid warning is 5.02:1 (asserted in
         * tests/unit/contrast.test.ts).
         *
         * It also reads better: a badge whose whole job is "you are NOT in production" should
         * be the loudest thing in the topbar, not a pastel hint.
         */
        <p className="rounded-sm bg-warning px-2 py-1 font-ui text-[11px] font-semibold tracking-wide text-white uppercase">
          {environment}
        </p>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* The storefront, for checking that a change actually landed. */}
        <Link
          href="/"
          className="hidden rounded-sm px-2 text-sm text-ink-600 underline underline-offset-4 hover:text-forest-800 sm:block"
        >
          View store
        </Link>

        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-ink-900">{name}</p>
          <p className="text-xs text-ink-500">{role}</p>
        </div>

        <form action={adminSignOut}>
          <SubmitButton variant="ghost" size="sm" loadingLabel="Signing out…">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Sign out</span>
          </SubmitButton>
        </form>
      </div>

      {/* Mobile drawer */}
      <div
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label="Admin menu"
        hidden={!open}
        className="fixed inset-0 z-50 lg:hidden"
      >
        <button
          type="button"
          aria-label="Close admin menu"
          onClick={() => setOpen(false)}
          className="absolute inset-0 size-full cursor-default bg-forest-950/40"
        />

        <div className="relative flex h-full w-[17rem] max-w-[85vw] flex-col bg-surface shadow-xl">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
            <span className="font-display text-lg font-semibold text-forest-900">BIOCODE</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="Close admin menu"
              className="inline-flex size-11 items-center justify-center rounded-md text-forest-800 hover:bg-forest-50"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 py-4">
            {sections.map((section) => (
              <div key={section.heading} className="mb-5">
                <h2 className="px-2 pb-1.5 font-ui text-[11px] font-semibold tracking-[0.08em] text-ink-500 uppercase">
                  {section.heading}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
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
                            'flex min-h-11 items-center gap-2.5 rounded-md px-2 text-sm',
                            active
                              ? 'bg-forest-100 font-medium text-forest-900'
                              : 'text-ink-600 hover:bg-forest-50',
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

          <div className="border-t border-line px-4 py-3">
            <p className="text-sm font-medium text-ink-900">{name}</p>
            <p className="text-xs text-ink-500">
              {email} · {role}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
