import {
  BadgeCheck,
  Boxes,
  ClipboardList,
  FileText,
  FolderTree,
  Gift,
  LayoutDashboard,
  Leaf,
  Package,
  Repeat,
  Settings,
  ShoppingCart,
  Star,
  Tags,
  Target,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Resolves a nav icon by name, on whichever side of the boundary is rendering.
 *
 * Exists because `NavItem` cannot carry a component: the admin layout is a Server Component
 * and the sidebar and topbar are client ones, so the nav crosses the boundary as props. React
 * serializes a component to `{$$typeof, render, displayName}` and refuses it —
 * "Functions cannot be passed directly to Client Components" — which is what took the whole
 * `/admin` tree down to the global error page the first time this shipped. The name is a
 * string, which serializes fine.
 *
 * An explicit record rather than a dynamic `lucide-react` lookup: this way the set is typed,
 * a typo is a compile error, and the bundler can tree-shake to exactly these sixteen icons
 * instead of pulling in the whole library.
 */
const ICONS = {
  dashboard: LayoutDashboard,
  orders: ShoppingCart,
  customers: Users,
  subscriptions: Repeat,
  products: Package,
  categories: FolderTree,
  brands: Tags,
  ingredients: Leaf,
  goals: Target,
  inventory: Boxes,
  movements: ClipboardList,
  content: FileText,
  reviews: Star,
  compliance: BadgeCheck,
  coupons: Gift,
  settings: Settings,
} as const satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof ICONS;

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
