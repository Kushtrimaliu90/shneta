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
