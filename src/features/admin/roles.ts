import type { NavIconName } from '@/features/admin/components/nav-icon';

/**
 * The docs/01 §3 permission matrix, as data.
 *
 * It is written once here because four things have to agree about it and they are in
 * different layers: the layout guard that decides whether `/admin` renders at all, the
 * sidebar that decides which links exist, the per-action role re-check, and the RLS policies.
 * Three of those four are TypeScript and can share this; the fourth is SQL and cannot, which
 * is exactly why RLS is the final guard and this is a convenience rather than the boundary.
 *
 * The failure this prevents is the subtle one: a sidebar that hides a link the action would
 * in fact allow, or shows one the action then rejects. Both read as bugs to an operator.
 */

export const USER_ROLES = [
  'customer',
  'merchant',
  'support',
  'product_manager',
  'content_manager',
  'warehouse_manager',
  'compliance_manager',
  'admin',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Everyone who may see `/admin` at all.
 *
 * **An explicit exclusion list, not "everyone except customer".** That is the whole point of this
 * edit: `STAFF_ROLES` used to be `USER_ROLES.filter(role => role !== 'customer')`, so adding
 * `merchant` to the enum above would silently have made every merchant staff — the same trap as
 * adding `merchant` to `is_staff()` in SQL (docs/16 §2), and here it would have opened `/admin`.
 *
 * Naming who is *not* staff means the next role added has to be considered rather than admitted.
 */
const NON_STAFF: readonly UserRole[] = ['customer', 'merchant'];

export const STAFF_ROLES = USER_ROLES.filter((role) => !NON_STAFF.includes(role));

export function toUserRole(value: string | null | undefined): UserRole {
  return (USER_ROLES as readonly string[]).includes(value ?? '') ? (value as UserRole) : 'customer';
}

/**
 * True for the marketplace role, which is deliberately **not** staff.
 *
 * A merchant is a counterparty, not a colleague: `STAFF_ROLES` gates `/admin` and most staff RLS
 * policies read `using (is_staff())`, so admitting `merchant` there would hand every merchant the
 * catalogue, the order queue and the audit log in one line (docs/16 §2).
 */
export function isMerchant(role: string | null | undefined): boolean {
  return role === 'merchant';
}

export function isStaff(role: string | null | undefined): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role ?? '');
}

/**
 * A capability is a thing a role may do, named after the matrix row rather than the route,
 * so `orders.refund` and `orders.ship` can diverge — which they must, since docs/01 §3 gives
 * warehouse "orders/ship only" — without inventing a fake URL for each.
 */
export type Capability =
  | 'dashboard.view'
  | 'orders.view'
  | 'orders.transition'
  | 'orders.ship'
  | 'orders.refund'
  | 'orders.editAddress'
  | 'customers.view'
  | 'products.manage'
  | 'catalog.manage'
  | 'content.manage'
  | 'inventory.manage'
  | 'compliance.approve'
  | 'biohack.view'
  | 'biohack.manage'
  | 'reviews.moderate'
  | 'coupons.view'
  | 'coupons.manage'
  | 'subscriptions.view'
  | 'settings.manage'
  | 'audit.view'
  // docs/16 §11 — marketplace. Applications and commission are admin; routing is support's daily
  // driver; offers and proposals belong to whoever already owns the catalogue.
  | 'merchants.view'
  | 'merchants.manage'
  | 'offers.review'
  | 'routing.manage'
  | 'payouts.manage'
  // docs/17 §5 — referrals. Support works the queue and can stop a link; everything that moves money
  // or changes the rate is admin.
  | 'referrals.view'
  | 'referrals.review'
  | 'referrals.manage'
  /*
   * The search console. Reading the report is a merchandising and catalogue question — what are people
   * asking for that we do not stock, and which queries return results nobody wants — so support gets to
   * look. Changing what search *does* is catalogue work and stays with the people who own the catalogue.
   */
  | 'search.view'
  | 'search.manage'
  // The homepage hero: slides, carousel settings, trust strip, announcement bar. Content work.
  | 'hero.manage'
  /*
   * Sponsored placements. Content work rather than marketplace work: the judgement an advertiser's
   * creative needs is the health-claim review in docs/08 §7, which is the content manager's job — and
   * approving a paid banner is not something a merchant should be able to do for themselves.
   */
  | 'placements.manage';

/**
 * Who holds each capability. `admin` is omitted from every list and granted unconditionally
 * by `can()` — the matrix gives admin every row, and repeating it seventeen times invites
 * the one omission that silently locks an admin out of their own panel.
 */
const CAPABILITIES: Record<Capability, readonly UserRole[]> = {
  'dashboard.view': STAFF_ROLES,
  'orders.view': ['support', 'warehouse_manager'],
  'orders.transition': ['support', 'warehouse_manager'],
  // docs/01 §3 — warehouse is "orders/ship only", so shipping is shared but money is not.
  'orders.ship': ['support', 'warehouse_manager'],
  'orders.refund': ['support'],
  'orders.editAddress': ['support', 'warehouse_manager'],
  'customers.view': ['support'],
  'products.manage': ['product_manager'],
  'catalog.manage': ['product_manager'],
  'content.manage': ['content_manager'],
  'inventory.manage': ['warehouse_manager', 'product_manager'],
  'compliance.approve': ['compliance_manager'],
  /*
   * docs/15 §4 — product managers build the ruleset, compliance approves it, and both have to
   * reach the screen. Split the way coupons already are: `view` opens `/admin/biohack` and the
   * simulator, `manage` is every mutation, approval stays on `compliance.approve`. One
   * capability for both would either hand compliance an editor or hide the diff they must sign.
   */
  'biohack.view': ['product_manager', 'compliance_manager'],
  'biohack.manage': ['product_manager'],
  'reviews.moderate': ['support', 'content_manager'],
  'coupons.view': ['support'],
  'coupons.manage': [],
  'subscriptions.view': ['support'],
  'settings.manage': [],
  'audit.view': [],
  'merchants.view': ['support', 'product_manager'],
  // Approving a merchant sets a commission and a shipping arrangement — a commercial decision.
  'merchants.manage': [],
  'offers.review': ['product_manager'],
  'routing.manage': ['support', 'warehouse_manager'],
  'payouts.manage': [],
  /*
   * docs/17 §5 — "`admin` full; `support` queue + revoke."
   *
   * Split three ways rather than two because the three actions carry different risk. Reading the queue
   * is harmless. Approving or revoking a link is reversible and is exactly the judgement call support
   * makes all day — "are these two the same person?" — so making them wait for an admin would leave
   * referrals pending for days. Creating a link by hand, extending a clock, or changing the rate all
   * mint money, and stay with admin.
   */
  'referrals.view': ['support'],
  'referrals.review': ['support'],
  'referrals.manage': [],
  // Support reads the report because "what are people searching for that we don't sell" is a customer
  // question they hear first; changing synonyms or ranking is catalogue work.
  'search.view': ['support', 'product_manager', 'content_manager'],
  'search.manage': ['product_manager', 'content_manager'],
  'hero.manage': ['content_manager'],
  'placements.manage': ['content_manager'],
};

/**
 * The single authority on whether a role may do something.
 *
 * Admin passes everything. Every other role must appear in the capability's list —
 * `coupons.manage`, `settings.manage` and `audit.view` have empty lists, which is not an
 * oversight: docs/01 §3 gives those rows to admin alone.
 */
export function can(role: string | null | undefined, capability: Capability): boolean {
  const normalized = toUserRole(role);
  if (normalized === 'admin') return true;
  return CAPABILITIES[capability].includes(normalized);
}

/**
 * The icon is a **name**, not a component.
 *
 * The sidebar and topbar are client components and the layout that filters this nav is a
 * server one, so these objects cross the server→client boundary as props. A React component
 * cannot: it serializes to `{$$typeof, render, displayName}` and React rejects it with
 * "Functions cannot be passed directly to Client Components" — which took down the whole
 * `/admin` tree into the global error page the first time this shipped.
 *
 * Passing a name and resolving it on the client keeps the server as the authority on *what is
 * visible*, which is the part that matters, while the icons resolve where they are rendered.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  capability: Capability;
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

/**
 * The full sidebar. Filtered per request by `visibleNav`, never rendered whole.
 *
 * Routes that do not exist yet are included with the capability they will need, because the
 * alternative — adding them to the sidebar at the same time as the page — is how a role ends
 * up able to reach a page nobody remembered to link. They are filtered by
 * `IMPLEMENTED` below so an operator is never offered a 404.
 */
const NAV: NavSection[] = [
  {
    heading: 'Operations',
    items: [
      { href: '/admin', label: 'Dashboard', icon: 'dashboard', capability: 'dashboard.view' },
      { href: '/admin/orders', label: 'Orders', icon: 'orders', capability: 'orders.view' },
      {
        href: '/admin/customers',
        label: 'Customers',
        icon: 'customers',
        capability: 'customers.view',
      },
      {
        href: '/admin/messages',
        label: 'Messages',
        icon: 'messages',
        capability: 'customers.view',
      },
      {
        href: '/admin/subscriptions',
        label: 'Subscriptions',
        icon: 'subscriptions',
        capability: 'subscriptions.view',
      },
    ],
  },
  {
    heading: 'Catalogue',
    items: [
      {
        href: '/admin/products',
        label: 'Products',
        icon: 'products',
        capability: 'products.manage',
      },
      {
        href: '/admin/categories',
        label: 'Categories',
        icon: 'categories',
        capability: 'catalog.manage',
      },
      { href: '/admin/brands', label: 'Brands', icon: 'brands', capability: 'catalog.manage' },
      {
        href: '/admin/ingredients',
        label: 'Ingredients',
        icon: 'ingredients',
        capability: 'catalog.manage',
      },
      { href: '/admin/goals', label: 'Health goals', icon: 'goals', capability: 'content.manage' },
      { href: '/admin/search', label: 'Search', icon: 'products', capability: 'search.view' },
      {
        href: '/admin/biohack',
        label: 'BioHack',
        icon: 'goals',
        capability: 'biohack.view',
      },
    ],
  },
  {
    heading: 'Warehouse',
    items: [
      {
        href: '/admin/inventory',
        label: 'Inventory',
        icon: 'inventory',
        capability: 'inventory.manage',
      },
      {
        href: '/admin/movements',
        label: 'Stock movements',
        icon: 'movements',
        capability: 'inventory.manage',
      },
    ],
  },
  {
    heading: 'Content and trust',
    items: [
      /*
       * Above Content, because it is the page an operator opens most and the one a campaign starts
       * from. It sits under "Content and trust" rather than "Catalogue": a hero slide is copy, imagery
       * and a schedule, which is the content manager's work — the capability is `hero.manage` and it
       * is granted to exactly that role.
       */
      { href: '/admin/hero', label: 'Homepage hero', icon: 'content', capability: 'hero.manage' },
      {
        href: '/admin/placements',
        label: 'Sponsored slots',
        icon: 'coupons',
        capability: 'placements.manage',
      },
      { href: '/admin/content', label: 'Content', icon: 'content', capability: 'content.manage' },
      { href: '/admin/reviews', label: 'Reviews', icon: 'reviews', capability: 'reviews.moderate' },
      {
        href: '/admin/compliance',
        label: 'Compliance',
        icon: 'compliance',
        capability: 'compliance.approve',
      },
      { href: '/admin/coupons', label: 'Coupons', icon: 'coupons', capability: 'coupons.view' },
      {
        href: '/admin/referrals',
        label: 'Referrals',
        icon: 'customers',
        capability: 'referrals.view',
      },
    ],
  },
  {
    heading: 'Marketplace',
    items: [
      {
        href: '/admin/merchants/applications',
        label: 'Merchants',
        icon: 'customers',
        capability: 'merchants.view',
      },
      {
        href: '/admin/merchants/proposals',
        label: 'Proposals',
        icon: 'goals',
        capability: 'offers.review',
      },
      {
        href: '/admin/merchants/offers',
        label: 'Merchant offers',
        icon: 'products',
        capability: 'offers.review',
      },
      {
        href: '/admin/routing',
        label: 'Routing',
        icon: 'orders',
        capability: 'routing.manage',
      },
      {
        href: '/admin/payouts',
        label: 'Payouts',
        icon: 'coupons',
        capability: 'payouts.manage',
      },
    ],
  },
  {
    heading: 'Administration',
    items: [
      {
        href: '/admin/settings',
        label: 'Settings',
        icon: 'settings',
        capability: 'settings.manage',
      },
    ],
  },
];

/**
 * Routes that actually exist. M5 ships the dashboard and orders, M6 the catalogue and
 * compliance; the rest arrive with M7–M10 and are hidden until then rather than linking an
 * operator to a 404.
 *
 * A list rather than a filesystem check because this file is imported by a client component
 * (the sidebar) and cannot read the filesystem. Extend it in the same commit that adds
 * the page.
 */
const IMPLEMENTED = new Set([
  '/admin',
  '/admin/orders',
  '/admin/products',
  '/admin/categories',
  '/admin/brands',
  '/admin/ingredients',
  '/admin/goals',
  '/admin/biohack',
  '/admin/compliance',
  '/admin/reviews',
  '/admin/messages',
  '/admin/subscriptions',
  '/admin/inventory',
  '/admin/movements',
  '/admin/customers',
  '/admin/coupons',
  '/admin/settings',
  '/admin/content',
  '/admin/merchants/applications',
  '/admin/merchants/offers',
  '/admin/merchants/proposals',
  '/admin/routing',
  '/admin/payouts',
  /*
   * These three shipped with their pages and were left out of this list, so the sidebar filtered
   * them away and each was reachable only by typing the URL — `/admin/referrals` since M13, and the
   * other two on the day they were built.
   *
   * The comment above says "extend it in the same commit that adds the page", which is exactly the
   * kind of instruction that gets followed until it doesn't. `tests/unit/admin-nav.test.ts` now
   * cross-checks this list against the filesystem, so the next omission fails a test rather than
   * quietly hiding a page for a milestone.
   */
  '/admin/referrals',
  '/admin/search',
  '/admin/hero',
  '/admin/placements',
]);

/** Exported for `tests/unit/admin-nav.test.ts`, which is the guard described above. */
export const IMPLEMENTED_ROUTES: ReadonlySet<string> = IMPLEMENTED;

/** Exported for the same test: every nav item, unfiltered. */
export const ALL_NAV_ITEMS: readonly NavItem[] = NAV.flatMap((section) => section.items);

/** The sections and items this role may see, with empty sections dropped. */
export function visibleNav(role: string | null | undefined): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => IMPLEMENTED.has(item.href) && can(role, item.capability)),
  })).filter((section) => section.items.length > 0);
}

/** Human-readable role, for the user menu. */
export function roleLabel(role: string | null | undefined): string {
  return toUserRole(role)
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
