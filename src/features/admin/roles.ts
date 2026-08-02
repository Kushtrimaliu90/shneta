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
  'support',
  'product_manager',
  'content_manager',
  'warehouse_manager',
  'compliance_manager',
  'admin',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Everyone who may see `/admin` at all. `customer` is deliberately absent. */
export const STAFF_ROLES = USER_ROLES.filter((role) => role !== 'customer');

export function toUserRole(value: string | null | undefined): UserRole {
  return (USER_ROLES as readonly string[]).includes(value ?? '') ? (value as UserRole) : 'customer';
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
  | 'audit.view';

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
      { href: '/admin/content', label: 'Content', icon: 'content', capability: 'content.manage' },
      { href: '/admin/reviews', label: 'Reviews', icon: 'reviews', capability: 'reviews.moderate' },
      {
        href: '/admin/compliance',
        label: 'Compliance',
        icon: 'compliance',
        capability: 'compliance.approve',
      },
      { href: '/admin/coupons', label: 'Coupons', icon: 'coupons', capability: 'coupons.view' },
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
]);

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
