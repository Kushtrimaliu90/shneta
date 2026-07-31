import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { formatPrice } from '@/lib/money';
import { pickLocale } from '@/lib/i18n';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime, PROVIDER_LABELS } from '@/features/admin/copy';
import { getOrder } from '@/features/orders/queries';
import type { OrderDetail } from '@/features/orders/types';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = {
  title: 'Print',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * docs/06 §2 — print-styled invoice and packing slip.
 *
 * **One route, two documents, chosen by `?doc=`.** They share a header, an address block, a
 * line-item table and a page break; only the columns and the footer differ. Two routes would
 * mean two places to fix a header that prints wrong.
 *
 * **`?ids=` takes a comma-separated list**, which is what makes the bulk case work: a warehouse
 * picking ten orders wants one print job with ten pages, not ten trips to the printer. Each
 * order gets `break-after-page`, so the browser's own pagination does the work.
 *
 * No print button and no `window.print()`. This is a Server Component with zero JavaScript —
 * the operator presses Ctrl-P, which they were going to do anyway, and which works when a
 * script fails to load. `@media print` hides the on-screen hint.
 *
 * A packing slip deliberately **omits money**. It travels in the box, and a customer who bought
 * a gift should not find the price in it — a real complaint in retail, and the reason the two
 * documents exist separately rather than one being the other with a different heading.
 */
export default async function PrintOrdersPage({ searchParams }: Props) {
  const [profile, params] = await Promise.all([getProfile(), searchParams]);

  if (!can(profile?.role, 'orders.view')) redirect('/admin');

  const raw = Array.isArray(params.ids) ? params.ids[0] : params.ids;
  const doc =
    (Array.isArray(params.doc) ? params.doc[0] : params.doc) === 'packing' ? 'packing' : 'invoice';

  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    // A generous cap: a print job of 50 is a real warehouse batch, 5000 is a mistake or an
    // attempt to make the server read the whole orders table one row at a time.
    .slice(0, 50);

  if (ids.length === 0) redirect('/admin/orders');

  // Sequential rather than parallel: fifty concurrent reads against one database to produce a
  // document nobody sees until the printer finishes is a poor trade.
  const orders: OrderDetail[] = [];
  for (const id of ids) {
    const order = await getOrder(id);
    if (order) orders.push(order);
  }

  if (orders.length === 0) redirect('/admin/orders');

  return (
    <div className="mx-auto max-w-[210mm] bg-white text-ink-900">
      {/*
        The only thing that does not print. `print:hidden` is Tailwind's `@media print` variant,
        so no custom stylesheet is needed.
      */}
      <div className="mb-6 rounded-md border border-line bg-forest-50 p-3 text-sm print:hidden">
        <strong>{orders.length}</strong> {doc === 'packing' ? 'packing slip' : 'invoice'}
        {orders.length === 1 ? '' : 's'} ready. Press <kbd>Ctrl</kbd>+<kbd>P</kbd> to print.
        {doc === 'packing' && ' Prices are omitted — this goes in the box.'}
      </div>

      {orders.map((order) => (
        <article
          key={order.id}
          // `break-after-page` on every order, so one print job yields one page each.
          className="break-after-page pb-8"
        >
          <header className="flex items-start justify-between gap-6 border-b-2 border-forest-800 pb-3">
            <div>
              <p className="font-display text-xl font-semibold text-forest-900">SHNETA</p>
              <p className="mt-0.5 text-xs text-ink-600">Prishtinë, Kosovë · shtrejt.com</p>
            </div>
            <div className="text-right">
              <p className="font-ui text-xs font-semibold tracking-wide text-ink-600 uppercase">
                {doc === 'packing' ? 'Packing slip' : 'Invoice'}
              </p>
              <p className="mt-0.5 font-semibold" data-numeric>
                {order.orderNumber}
              </p>
              <p className="text-xs text-ink-600" data-numeric>
                {formatAdminDateTime(order.placedAt).display}
              </p>
            </div>
          </header>

          <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
            <section>
              <h2 className="font-ui text-[11px] font-semibold tracking-wide text-ink-600 uppercase">
                Deliver to
              </h2>
              <address className="mt-1 leading-relaxed not-italic">
                {[
                  order.shippingAddress.recipient_name,
                  order.shippingAddress.line1,
                  order.shippingAddress.line2,
                  [order.shippingAddress.postal_code, order.shippingAddress.city]
                    .filter(Boolean)
                    .join(' '),
                  order.shippingAddress.phone,
                ]
                  .filter((line): line is string => Boolean(line))
                  .map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
              </address>
            </section>

            <section>
              <h2 className="font-ui text-[11px] font-semibold tracking-wide text-ink-600 uppercase">
                Delivery
              </h2>
              <p className="mt-1">{pickLocale(order.shippingMethodName, 'en')}</p>
              {/*
                The COD amount belongs on BOTH documents. The courier reads the packing slip at
                the door and has to know what to collect — omitting prices from a packing slip
                means item prices, not the amount owed.
              */}
              {order.payments.some(
                (payment) => payment.provider === 'cod' && payment.status === 'pending',
              ) && (
                <p className="mt-2 border border-forest-800 px-2 py-1 font-semibold" data-numeric>
                  COLLECT {formatPrice(order.totalCents, 'en')}
                </p>
              )}
              {order.payments.some((payment) => payment.status === 'paid') && (
                <p className="mt-2 font-semibold">PAID — collect nothing</p>
              )}
            </section>
          </div>

          <table className="mt-6 w-full border-collapse text-sm">
            <caption className="sr-only">Items in order {order.orderNumber}</caption>
            <thead>
              <tr className="border-b border-ink-900 text-left">
                <th scope="col" className="py-1.5 font-ui text-[11px] font-semibold uppercase">
                  Item
                </th>
                <th scope="col" className="py-1.5 font-ui text-[11px] font-semibold uppercase">
                  SKU
                </th>
                <th
                  scope="col"
                  className="py-1.5 text-right font-ui text-[11px] font-semibold uppercase"
                >
                  Qty
                </th>
                {doc === 'invoice' && (
                  <>
                    <th
                      scope="col"
                      className="py-1.5 text-right font-ui text-[11px] font-semibold uppercase"
                    >
                      Unit
                    </th>
                    <th
                      scope="col"
                      className="py-1.5 text-right font-ui text-[11px] font-semibold uppercase"
                    >
                      Total
                    </th>
                  </>
                )}
                {doc === 'packing' && (
                  // A column to tick with a pen. The whole reason a picker prints anything.
                  <th
                    scope="col"
                    className="py-1.5 text-right font-ui text-[11px] font-semibold uppercase"
                  >
                    Picked
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-line">
                  <td className="py-2">{item.name}</td>
                  <td className="py-2 text-xs" data-numeric>
                    {item.sku}
                  </td>
                  <td className="py-2 text-right font-semibold" data-numeric>
                    {item.quantity}
                  </td>
                  {doc === 'invoice' && (
                    <>
                      <td className="py-2 text-right" data-numeric>
                        {formatPrice(item.unitPriceCents, 'en')}
                      </td>
                      <td className="py-2 text-right" data-numeric>
                        {formatPrice(item.totalCents, 'en')}
                      </td>
                    </>
                  )}
                  {doc === 'packing' && (
                    <td className="py-2 text-right">
                      <span className="inline-block size-4 border border-ink-900" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {doc === 'invoice' && (
            <div className="mt-4 flex justify-end">
              <dl className="w-56 text-sm">
                <div className="flex justify-between py-0.5">
                  <dt>Subtotal</dt>
                  <dd data-numeric>{formatPrice(order.subtotalCents, 'en')}</dd>
                </div>
                {order.discountCents > 0 && (
                  <div className="flex justify-between py-0.5">
                    <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
                    <dd data-numeric>−{formatPrice(order.discountCents, 'en')}</dd>
                  </div>
                )}
                <div className="flex justify-between py-0.5">
                  <dt>Delivery</dt>
                  <dd data-numeric>
                    {order.shippingCents === 0 ? 'Free' : formatPrice(order.shippingCents, 'en')}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-ink-900 py-1 font-semibold">
                  <dt>Total</dt>
                  <dd data-numeric>{formatPrice(order.totalCents, 'en')}</dd>
                </div>
                {/*
                  docs/07 §5 — prices are VAT-inclusive, so VAT is shown as contained within the
                  total, never added to it. Printing it as a separate line to be summed would be
                  wrong by the VAT amount, and this is the document an accountant reads.
                */}
                <div className="flex justify-between py-0.5 text-xs text-ink-600">
                  <dt>of which VAT</dt>
                  <dd data-numeric>{formatPrice(order.taxCents, 'en')}</dd>
                </div>
              </dl>
            </div>
          )}

          {order.customerNote && (
            <div className="mt-5 border border-line p-2 text-sm">
              <p className="font-ui text-[11px] font-semibold tracking-wide text-ink-600 uppercase">
                Customer note
              </p>
              <p className="mt-0.5">{order.customerNote}</p>
            </div>
          )}

          <footer className="mt-6 border-t border-line pt-2 text-xs text-ink-600">
            {doc === 'invoice' ? (
              <p>
                Payment:{' '}
                {order.payments.map((p) => PROVIDER_LABELS[p.provider] ?? p.provider).join(', ') ||
                  '—'}
                . Questions about this order: quote {order.orderNumber}.
              </p>
            ) : (
              <p>Thank you for your order. Keep this slip if you need to return anything.</p>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
