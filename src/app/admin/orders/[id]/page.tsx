import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { buttonVariants } from '@/components/ui/button';
import { pickLocale } from '@/lib/i18n';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime, PROVIDER_LABELS } from '@/features/admin/copy';
import { OrderStatusBadge, PaymentStatusBadge } from '@/features/admin/components/status-badge';
import { getOrder } from '@/features/orders/queries';
import { allowedTransitions } from '@/features/orders/types';
import {
  OrderDangerZone,
  OrderTransitions,
  ShipmentForm,
} from '@/features/orders/components/order-actions';
import { OrderTimeline } from '@/features/orders/components/order-timeline';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const order = await getOrder((await params).id);
  return { title: order ? `Order ${order.orderNumber}` : 'Order' };
}

/**
 * docs/06 §2 — order detail, three columns.
 *
 * Main: items and totals. Side: customer, addresses, payment, shipment. Timeline: the full
 * `order_events` log plus a box to add an internal note.
 *
 * Money is formatted with the `'en'` locale throughout, deliberately. The admin UI is English
 * (docs/01 §3), and an operator reading a queue needs one consistent number format — reading
 * `9,90 €` on one row and `€9.90` on the next, because two customers chose different languages,
 * is how a mistake gets made. The *customer's* copies of the same figures, in emails and in
 * their account, use `order.locale`.
 */
export default async function AdminOrderDetailPage({ params }: Props) {
  const [{ id }, profile] = await Promise.all([params, getProfile()]);

  if (!can(profile?.role, 'orders.view')) redirect('/admin');

  const order = await getOrder(id);
  if (!order) notFound();

  const placed = formatAdminDateTime(order.placedAt);
  const money = (cents: number) => formatPrice(cents, 'en');
  const shippable = allowedTransitions(order.status).includes('shipped');

  const addressLines = (address: typeof order.shippingAddress) =>
    [
      address.recipient_name,
      address.line1,
      address.line2,
      [address.postal_code, address.city].filter(Boolean).join(' '),
      address.phone,
    ].filter((line): line is string => Boolean(line));

  return (
    <div>
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-ink-600 hover:text-forest-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All orders
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900" data-numeric>
            {order.orderNumber}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            <time dateTime={order.placedAt} title={placed.utc} data-numeric>
              {placed.display}
            </time>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
        </div>
      </div>

      {/* Header actions, by state machine (docs/06 §2). */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {can(profile?.role, 'orders.transition') && (
          <OrderTransitions orderId={order.id} status={order.status} />
        )}
        {shippable && can(profile?.role, 'orders.ship') && <ShipmentForm orderId={order.id} />}

        {/*
          docs/06 §2 — print documents. Plain links opening in a new tab rather than a client
          component calling window.print(): the operator presses Ctrl-P, which works with no
          JavaScript, and the original page stays where it was.
        */}
        <Link
          href={`/admin/orders/print?ids=&doc=packing`}
          target="_blank"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Printer className="size-4" aria-hidden="true" />
          Packing slip
        </Link>
        <Link
          href={`/admin/orders/print?ids=&doc=invoice`}
          target="_blank"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          <Printer className="size-4" aria-hidden="true" />
          Invoice
        </Link>
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.5fr_1fr]">
        {/* ── Main ─────────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <section aria-labelledby="items-heading">
            <h2
              id="items-heading"
              className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
            >
              Items
            </h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[30rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-forest-50 text-left">
                    <th
                      scope="col"
                      className="px-4 py-2.5 font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      Product
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      Qty
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      Unit
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-2.5 text-right font-ui text-xs font-semibold text-ink-600 uppercase"
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <span className="block text-ink-900">{item.name}</span>
                        <span className="block text-xs text-ink-500" data-numeric>
                          {item.sku}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" data-numeric>
                        {item.quantity}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" data-numeric>
                        {money(item.unitPriceCents)}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-medium whitespace-nowrap"
                        data-numeric
                      >
                        {money(item.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 ml-auto flex max-w-xs flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Subtotal</dt>
                <dd data-numeric>{money(order.subtotalCents)}</dd>
              </div>
              {order.discountCents > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-600">
                    Discount{order.couponCode ? ` (${order.couponCode})` : ''}
                  </dt>
                  <dd className="text-success" data-numeric>
                    −{money(order.discountCents)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-ink-600">Delivery</dt>
                <dd data-numeric>
                  {order.shippingCents === 0 ? 'Free' : money(order.shippingCents)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                <dt>Total</dt>
                <dd data-numeric>{money(order.totalCents)}</dd>
              </div>
              <p className="text-xs text-ink-500">Includes VAT {money(order.taxCents)}</p>
              {order.refundedCents > 0 && (
                <p className="text-xs text-error" data-numeric>
                  Refunded {money(order.refundedCents)}
                </p>
              )}
            </dl>
          </section>

          {order.customerNote && (
            <section aria-labelledby="note-heading" className="mt-8">
              <h2
                id="note-heading"
                className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase"
              >
                Customer note
              </h2>
              <p className="mt-2 rounded-md bg-forest-50 p-3 text-sm text-ink-900">
                {order.customerNote}
              </p>
            </section>
          )}

          <OrderDangerZone
            orderId={order.id}
            status={order.status}
            totalCents={order.totalCents}
            refundedCents={order.refundedCents}
            mayRefund={can(profile?.role, 'orders.refund')}
          />
        </div>

        {/* ── Side ─────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Customer">
            <p className="text-sm text-ink-900">{order.shippingAddress.recipient_name ?? '—'}</p>
            <p className="text-sm text-ink-600">{order.email}</p>
            <p className="text-sm text-ink-600" data-numeric>
              {order.phone}
            </p>
            {/* docs/06 §2 — a guest badge, because it changes how support follows up. */}
            {!order.userId && (
              <p className="mt-2 inline-block rounded-sm bg-forest-100 px-2 py-0.5 font-ui text-xs font-semibold text-forest-900">
                Guest order
              </p>
            )}
          </Card>

          <Card title="Delivery address">
            <address className="text-sm leading-relaxed text-ink-600 not-italic">
              {addressLines(order.shippingAddress).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
            <p className="mt-2 text-sm text-ink-600">
              {pickLocale(order.shippingMethodName, 'en')}
              {order.minDays != null && order.maxDays != null
                ? ` · ${order.minDays}–${order.maxDays} days`
                : ''}
            </p>
          </Card>

          <Card title="Payment">
            {order.payments.length === 0 ? (
              <p className="text-sm text-ink-600">No payment record.</p>
            ) : (
              order.payments.map((payment) => (
                <div key={payment.id} className="text-sm">
                  <p className="text-ink-900">
                    {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                  </p>
                  {/* docs/06 §2 — COD shows what the courier must collect. */}
                  {payment.provider === 'cod' && payment.status === 'pending' && (
                    <p className="mt-1 font-medium text-forest-900" data-numeric>
                      Collect {money(payment.amountCents)}
                    </p>
                  )}
                  {payment.providerRef && (
                    <p className="mt-1 text-xs text-ink-500" data-numeric>
                      Ref {payment.providerRef}
                    </p>
                  )}
                </div>
              ))
            )}
          </Card>

          <Card title="Shipment">
            {order.shipments.length === 0 ? (
              <p className="text-sm text-ink-600">Not shipped yet.</p>
            ) : (
              order.shipments.map((shipment) => (
                <div key={shipment.id} className="text-sm">
                  <p className="text-ink-900">{shipment.carrier ?? '—'}</p>
                  <p className="mt-0.5 text-ink-600" data-numeric>
                    {shipment.trackingUrl ? (
                      <a
                        href={shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-sm text-forest-800 underline underline-offset-4"
                      >
                        {shipment.trackingNumber}
                      </a>
                    ) : (
                      shipment.trackingNumber
                    )}
                  </p>
                  {shipment.shippedAt && (
                    <p className="mt-1 text-xs text-ink-500" data-numeric>
                      {formatAdminDateTime(shipment.shippedAt).display}
                    </p>
                  )}
                </div>
              ))
            )}
          </Card>

          {order.refunds.length > 0 && (
            <Card title="Refunds">
              {order.refunds.map((refund) => (
                <div key={refund.id} className="border-b border-line py-2 text-sm last:border-0">
                  <p className="font-medium text-ink-900" data-numeric>
                    {money(refund.amountCents)}
                  </p>
                  <p className="text-xs text-ink-600">{refund.reason}</p>
                  <p className="text-xs text-ink-500" data-numeric>
                    {formatAdminDateTime(refund.createdAt).display}
                    {refund.restock ? ' · restocked' : ''}
                  </p>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <div className="mt-10">
        <OrderTimeline orderId={order.id} events={order.events} />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
