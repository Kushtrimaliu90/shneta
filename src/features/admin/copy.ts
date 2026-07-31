import type { OrderErrorKey } from '@/features/orders/actions';

/**
 * English strings for the admin panel.
 *
 * The admin UI is not localized (docs/01 §3), so it has no next-intl provider and cannot call
 * `t()`. Actions still return dotted identifiers rather than finished sentences, because an
 * action is server code that should not decide how a message reads — and because the same
 * identifiers are what an audit row or a log line records.
 *
 * This is where they become words. A `Record` keyed on the union means adding an error key
 * without a message is a compile error, which is the property that stops `admin.errors.generic`
 * quietly becoming the message for everything.
 */
export const ORDER_ERRORS: Record<OrderErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.orders.errors.invalidTransition':
    'That status change is no longer possible — someone may have updated this order. Reload and check.',
  'admin.orders.errors.notFound': 'That order no longer exists.',
  'admin.orders.errors.checkFields': 'Check the fields marked below.',
  'admin.orders.errors.refundTooLarge': 'That would refund more than the order total.',
  'admin.orders.errors.refundInvalidAmount': 'Enter an amount like 12.50.',
};

/** Order statuses as an operator reads them, not as the enum spells them. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Being prepared',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Unpaid',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  partially_refunded: 'Partly refunded',
};

/** The button copy for each transition — a verb, not a status name. */
export const TRANSITION_LABELS: Record<string, string> = {
  confirmed: 'Confirm order',
  processing: 'Start preparing',
  shipped: 'Mark shipped',
  delivered: 'Mark delivered',
};

export const PROVIDER_LABELS: Record<string, string> = {
  cod: 'Cash on delivery',
  bank_pos: 'Bank card',
  stripe: 'Stripe',
};

/**
 * Timestamps in the admin panel are Europe/Belgrade with UTC on hover (docs/06 §16).
 *
 * Belgrade rather than a Kosovo zone because `Europe/Pristina` is not in the IANA database as a
 * canonical zone — Kosovo shares Belgrade's offset, which is what the spec asks for.
 *
 * `sv-SE` gives an ISO-shaped `YYYY-MM-DD HH:mm` without needing a format string. It is a
 * formatting trick, not a language choice: no admin string is Swedish.
 */
export function formatAdminDateTime(iso: string): { display: string; utc: string } {
  const date = new Date(iso);
  return {
    display: date.toLocaleString('sv-SE', {
      timeZone: 'Europe/Belgrade',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    utc: `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  };
}
