import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, IMPLEMENTED_ROUTES, visibleNav } from '@/features/admin/roles';

/**
 * The sidebar must offer every admin page that exists, and no page that does not.
 *
 * ── Why this test exists ──
 *
 * `roles.ts` filters the sidebar through an `IMPLEMENTED` allowlist so an operator is never linked to
 * a route that has not been built. Its own comment says "extend it in the same commit that adds the
 * page", and that instruction was followed until it wasn't: **three** pages shipped without it —
 * `/admin/referrals` at M13, then `/admin/search` and `/admin/hero` on the days they were built. All
 * three existed, were guarded, worked, and were reachable only by someone who already knew the URL.
 *
 * The allowlist cannot check the filesystem itself: `roles.ts` is imported by the sidebar, which is a
 * client component. A test has no such restriction, so the check lives here instead of being a comment
 * asking people to remember.
 */

/** Every `/admin/...` route with a `page.tsx`, ignoring dynamic and group segments. */
function adminRoutes(dir = join(process.cwd(), 'src', 'app', 'admin'), base = '/admin'): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // `[id]` is a detail page reached from a list, `(group)` is not a URL segment. Neither is a
      // sidebar destination.
      if (entry.name.startsWith('[') || entry.name.startsWith('(')) continue;
      found.push(...adminRoutes(join(dir, entry.name), `${base}/${entry.name}`));
    } else if (entry.name === 'page.tsx') {
      found.push(base);
    }
  }

  return found;
}

describe('admin sidebar', () => {
  const routes = adminRoutes();

  it('finds the admin pages at all', () => {
    // A sanity check on the walker: if it silently returned nothing, every assertion below would
    // pass while testing nothing.
    expect(routes.length).toBeGreaterThan(10);
    expect(routes).toContain('/admin');
  });

  it('never links to a route that does not exist', () => {
    const orphans = ALL_NAV_ITEMS.filter(
      (item) => IMPLEMENTED_ROUTES.has(item.href) && !routes.includes(item.href),
    ).map((item) => item.href);

    expect(orphans, 'these nav items are marked implemented but have no page').toEqual([]);
  });

  it('offers every page that has a nav entry', () => {
    /*
     * The failure that prompted this. A page can exist, carry a nav entry and still be invisible,
     * because the allowlist is a third thing that has to agree with the other two.
     */
    const hidden = ALL_NAV_ITEMS.filter(
      (item) => routes.includes(item.href) && !IMPLEMENTED_ROUTES.has(item.href),
    ).map((item) => item.href);

    expect(hidden, 'these pages exist and are hidden from the sidebar by IMPLEMENTED').toEqual([]);
  });

  it('shows an admin the hero, search and referral consoles', () => {
    const hrefs = visibleNav('admin').flatMap((section) => section.items.map((item) => item.href));

    // Named explicitly rather than left to the general rule above, because these are the three that
    // were actually missing and a regression on any of them should say which.
    expect(hrefs).toContain('/admin/hero');
    expect(hrefs).toContain('/admin/search');
    expect(hrefs).toContain('/admin/referrals');
  });

  it('keeps the hero out of a role that cannot manage it', () => {
    // `hero.manage` is content work. A warehouse manager seeing the link would be a capability leak
    // in the sidebar, which is the failure the whole filter exists to prevent.
    const hrefs = visibleNav('warehouse_manager').flatMap((section) =>
      section.items.map((item) => item.href),
    );
    expect(hrefs).not.toContain('/admin/hero');
  });
});
