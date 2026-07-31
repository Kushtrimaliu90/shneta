import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { roleLabel } from '@/features/admin/roles';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * docs/06 §1 — the dashboard.
 *
 * Placeholder for now: the KPI row, revenue chart and action queues land later in M5, once
 * the orders list they all link into exists. Building the queues first would mean five cards
 * pointing at a page that does not yet accept filters.
 */
export default async function AdminDashboardPage() {
  const profile = await getProfile();

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Dashboard</h1>
      <p className="mt-2 text-sm text-ink-600">
        Signed in as {profile?.email} · {roleLabel(profile?.role)}
      </p>

      <div className="mt-8 rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-forest-900">Coming next in M5</h2>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-600">
          <li>KPI row — revenue, orders, AOV, new customers (today / 7 d / 30 d)</li>
          <li>Revenue by day and orders-by-status charts</li>
          <li>Action queues — orders awaiting confirmation, low stock, pending reviews</li>
        </ul>
      </div>
    </div>
  );
}
