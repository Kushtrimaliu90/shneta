import { getLocale, getTranslations } from 'next-intl/server';
import { ORDER_STATUSES, type OrderEvent, type OrderStatus } from '@/features/orders/types';

/**
 * docs/05 §14 — the customer's view of their order history.
 *
 * **No filtering happens here.** `p_read on order_events` already restricts a customer to rows
 * where `is_customer_visible`, so an internal note never reaches this component — it never
 * leaves the database. Filtering in TypeScript as well would look like the safeguard and
 * quietly become the one people trust, which is exactly backwards: the day someone reads these
 * events through a different query, only the policy protects them.
 *
 * A Server Component, so the timeline ships no JavaScript. There is nothing to interact with.
 */

/**
 * Turns a `status_changed` message into a sentence in the customer's language.
 *
 * The stored message is `"pending → confirmed"`, written by `orders_after_status_change` for
 * operators. Showing that to a customer would leak the internal vocabulary and be untranslated
 * besides, so the target status is parsed out and rendered through `order.status.*` — the same
 * keys the badge uses, which is what keeps the two consistent.
 */
function targetStatus(message: string | null): OrderStatus | null {
  if (!message) return null;
  const to = message.split('→').pop()?.trim() ?? '';
  return (ORDER_STATUSES as readonly string[]).includes(to) ? (to as OrderStatus) : null;
}

export async function CustomerTimeline({ events }: { events: OrderEvent[] }) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);

  if (events.length === 0) return null;

  return (
    <section aria-labelledby="customer-timeline">
      <h2 id="customer-timeline" className="font-display text-lg font-semibold text-carbon-900">
        {t('order.timeline.title')}
      </h2>

      <ol className="mt-3 flex flex-col">
        {events.map((event) => {
          const status = event.type === 'status_changed' ? targetStatus(event.message) : null;

          return (
            <li
              key={event.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line py-3 text-sm last:border-0"
            >
              <time
                dateTime={event.createdAt}
                className="w-32 shrink-0 text-xs text-ink-500"
                data-numeric
              >
                {new Date(event.createdAt).toLocaleDateString(locale, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </time>
              <span className="text-ink-900">
                {status
                  ? t('order.timeline.statusBecame', { status: t(`order.status.${status}`) })
                  : (event.message ?? t('order.timeline.updated'))}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
