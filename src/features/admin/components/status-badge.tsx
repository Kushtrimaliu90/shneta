import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/features/admin/copy';
import { cn } from '@/lib/utils';

/**
 * Status pills for the orders table and detail header.
 *
 * Three constraints, and they narrow the design almost completely:
 *
 * 1. **Tokens only** (CLAUDE.md §9). The first version reached for `bg-[#dbeafe]`-style hex to
 *    get seven distinguishable colours, which is exactly the arbitrary-palette drift that rule
 *    exists to stop. Everything below comes from `globals.css`.
 * 2. **Never colour alone** (docs/04 §10, WCAG 1.4.1). Every pill carries its word. The colour
 *    is there so an operator can scan fifty rows; the word is there so the queue still works
 *    for someone who cannot separate amber from green.
 * 3. **AA at badge size.** Solid semantic fills with white text, not `/15` tints of the same
 *    colour — that tint pattern is what put the environment badge at 4.08:1 (docs/13 §I5).
 *    White clears AA on warning, success, error, info, forest-800 and ink-600, all asserted in
 *    `tests/unit/contrast.test.ts`.
 *
 * The ordering is deliberate too: `confirmed` is the pale forest tint and `processing` the deep
 * one, so the two mid-pipeline states are distinguishable at a glance without a third hue.
 */

const ORDER_TONES: Record<string, string> = {
  pending: 'bg-warning text-white',
  confirmed: 'bg-forest-100 text-forest-900',
  processing: 'bg-forest-800 text-white',
  shipped: 'bg-info text-white',
  delivered: 'bg-success text-white',
  cancelled: 'bg-ink-600 text-white',
  refunded: 'bg-error text-white',
};

const PAYMENT_TONES: Record<string, string> = {
  pending: 'bg-warning text-white',
  paid: 'bg-success text-white',
  failed: 'bg-error text-white',
  refunded: 'bg-error text-white',
  partially_refunded: 'bg-error text-white',
};

const BASE =
  'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold whitespace-nowrap';

/** Unknown values fall back to the neutral fill rather than to no styling at all. */
const FALLBACK = 'bg-ink-600 text-white';

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(BASE, ORDER_TONES[status] ?? FALLBACK)}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(BASE, PAYMENT_TONES[status] ?? FALLBACK)}>
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
