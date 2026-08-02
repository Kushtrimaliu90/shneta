import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { formatPrice } from '@/lib/money';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime, ORDER_STATUS_LABELS } from '@/features/admin/copy';
import { getCustomer } from '@/features/customers/queries';
import { AnonymizeCustomer, LoyaltyAdjuster } from '@/features/customers/components/customer-tools';

export const metadata: Metadata = { title: 'Customer' };

type Props = { params: Promise<{ id: string }> };

const LEDGER_REASONS: Record<string, string> = {
  earn_order: 'Earned on an order',
  redeem: 'Exchanged for a coupon',
  adjustment: 'Manual adjustment',
  expiry: 'Expired',
  clawback: 'Taken back after a refund',
};

/**
 * docs/06 §9 — one customer.
 *
 * Read-mostly. The two things an agent can change are points and existence; everything else is
 * a link to the thing that owns it — the order, the subscription. A detail page that lets you
 * edit six unrelated records is a page where nobody can say what "save" did.
 */
export default async function AdminCustomerPage({ params }: Props) {
  const [profile, { id }] = await Promise.all([getProfile(), params]);

  if (!can(profile?.role, 'customers.view')) redirect('/admin');

  const customer = await getCustomer(id);
  if (!customer) notFound();

  const isAdmin = can(profile?.role, 'settings.manage');
  const joined = formatAdminDateTime(customer.createdAt);

  return (
    <div className="max-w-4xl">
      <Link
        href="/admin/customers"
        className="text-sm text-forest-800 underline underline-offset-4"
      >
        ← All customers
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">
            {customer.fullName || customer.email}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {customer.email}
            {customer.phone && <> · {customer.phone}</>}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Joined{' '}
            <time dateTime={customer.createdAt} title={joined.utc} data-numeric>
              {joined.display}
            </time>
            {customer.marketingOptIn ? ' · accepts marketing' : ' · no marketing'}
          </p>
        </div>

        {/*
          A route handler rather than a server action: the response is a file download, and an
          action can only return serialisable data to the client. docs/06 §9 asks for JSON.
        */}
        <a
          href={`/admin/customers/${customer.id}/export`}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line-strong px-3 text-sm text-ink-900 hover:bg-forest-50"
        >
          <Download className="size-4" aria-hidden="true" />
          Export data (JSON)
        </a>
      </div>

      {customer.deletedAt && (
        <p className="mt-4 rounded-lg border border-line-strong bg-cream p-3 text-sm text-ink-900">
          This customer&rsquo;s data was erased on{' '}
          <span data-numeric>{customer.deletedAt.slice(0, 10)}</span>. What is left is the
          commercial record.
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Orders', value: String(customer.ordersCount) },
          { label: 'Lifetime', value: formatPrice(customer.lifetimeCents, 'sq') },
          { label: 'Points', value: String(customer.loyaltyPoints) },
          { label: 'Subscriptions', value: String(customer.activeSubscriptions) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-line bg-surface p-3">
            <dt className="font-ui text-xs text-ink-600 uppercase">{stat.label}</dt>
            <dd className="mt-1 font-display text-xl font-semibold text-forest-900" data-numeric>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <Section title="Orders">
        {customer.orders.length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {customer.orders.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="rounded-sm text-forest-800 underline underline-offset-4"
                  data-numeric
                >
                  {order.orderNumber}
                </Link>
                <span className="text-ink-600">
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </span>
                <span className="text-ink-900" data-numeric>
                  {formatPrice(order.totalCents, 'sq')}
                </span>
                <span className="text-xs text-ink-500" data-numeric>
                  {order.placedAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Addresses">
        {customer.addresses.length === 0 ? (
          <Empty>No saved addresses.</Empty>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {customer.addresses.map((address) => (
              <li key={address.id} className="rounded-sm border border-line p-3 text-sm">
                <p className="font-medium text-ink-900">
                  {address.recipientName}
                  {address.isDefaultShipping && (
                    <span className="ml-2 rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900">
                      Default
                    </span>
                  )}
                </p>
                <p className="text-ink-600">
                  {address.line1}
                  {address.line2 && <>, {address.line2}</>}
                </p>
                <p className="text-ink-600">
                  {address.postalCode && <span data-numeric>{address.postalCode} </span>}
                  {address.city}, {address.countryCode}
                </p>
                <p className="text-xs text-ink-500" data-numeric>
                  {address.phone}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Subscriptions">
        {customer.subscriptions.length === 0 ? (
          <Empty>No subscriptions.</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {customer.subscriptions.map((sub) => (
              <li key={sub.id} className="flex items-center justify-between">
                <span className="text-ink-900" data-numeric>
                  Every {sub.frequencyDays} days
                </span>
                <span className="text-ink-600">{sub.status}</span>
                <span className="text-xs text-ink-500" data-numeric>
                  next {sub.nextRunAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Loyalty">
        <LoyaltyAdjuster userId={customer.id} balance={customer.loyaltyPoints} />

        {customer.ledger.length === 0 ? (
          <Empty>No points activity yet.</Empty>
        ) : (
          <ul className="mt-4 flex flex-col gap-1.5 text-sm">
            {customer.ledger.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3">
                <span className="text-ink-600">
                  {LEDGER_REASONS[entry.reason] ?? entry.reason}
                  {entry.note && <span className="text-ink-500"> — {entry.note}</span>}
                </span>
                <span className={entry.points > 0 ? 'text-success' : 'text-error'} data-numeric>
                  {entry.points > 0 ? `+${entry.points}` : entry.points}
                </span>
                <span className="text-xs text-ink-500" data-numeric>
                  {entry.createdAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* docs/06 §9 — "anonymize (admin only)". Support sees the export; only admin sees this. */}
      {isAdmin && !customer.deletedAt && (
        <Section title="Data protection">
          <p className="max-w-prose text-sm text-ink-600">
            A customer may ask for their data to be exported or erased. Export first — once erased,
            there is nothing left to export.
          </p>
          <AnonymizeCustomer userId={customer.id} email={customer.email} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-500">{children}</p>;
}
