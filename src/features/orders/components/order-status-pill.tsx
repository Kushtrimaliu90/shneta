import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/features/orders/types';

/**
 * The customer-facing status pill — the localized twin of the admin `OrderStatusBadge`.
 *
 * Two components rather than one with a locale prop, because they are genuinely different:
 * this one resolves its label through `t('order.status.…')` and lives inside a next-intl
 * provider, while the admin badge reads a plain English record and lives in a tree that has no
 * provider at all (docs/01 §3). A single component would have to take its label as a prop,
 * which just moves the duplication to every call site.
 *
 * What they *do* share is the palette and the rule behind it: solid semantic fills with white
 * text, never a `/15` tint of the same colour, and always the word alongside the colour
 * (docs/04 §10). Those combinations are asserted in `tests/unit/contrast.test.ts`.
 */
const TONES: Record<OrderStatus, string> = {
  pending: 'bg-warning text-white',
  confirmed: 'bg-carbon-100 text-carbon-900',
  processing: 'bg-carbon-800 text-white',
  shipped: 'bg-info text-white',
  delivered: 'bg-success text-white',
  cancelled: 'bg-ink-600 text-white',
  refunded: 'bg-error text-white',
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const t = useTranslations('order.status');

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold whitespace-nowrap',
        TONES[status],
      )}
    >
      {t(status)}
    </span>
  );
}
