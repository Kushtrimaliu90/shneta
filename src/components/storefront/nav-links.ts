/**
 * The primary navigation set (docs/04 §6). Kept as data so the desktop bar, the mobile
 * sheet and the footer cannot drift apart.
 *
 * `key` is a message key under the `nav` namespace; `check:i18n` guarantees both locales
 * define it.
 */
export interface NavLink {
  key: 'shop' | 'goals' | 'ingredients' | 'brands' | 'knowledge' | 'offers';
  href: string;
}

export const PRIMARY_NAV: readonly NavLink[] = [
  { key: 'shop', href: '/shop' },
  { key: 'goals', href: '/goals' },
  { key: 'ingredients', href: '/ingredients' },
  { key: 'brands', href: '/brands' },
  { key: 'knowledge', href: '/knowledge' },
  { key: 'offers', href: '/offers' },
] as const;

/**
 * Whether `href` is the section the visitor is in, matched on the **first path segment** so
 * `/shop/vitamins` lights Shop and `/knowledge/some-guide` lights Knowledge (docs/04 §3 —
 * `forest-700` is "links, active nav"). One definition, shared by the desktop bar and the
 * mobile sheet, so the two cannot disagree about where the visitor is. Pathnames come from the
 * locale-aware `usePathname` in `@/i18n/routing`, which strips the locale prefix.
 */
export function isActiveNavPath(pathname: string, href: string): boolean {
  return (pathname.split('/')[1] ?? '') === (href.split('/')[1] ?? '');
}
