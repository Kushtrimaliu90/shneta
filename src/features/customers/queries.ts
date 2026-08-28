import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/06 §9 — customer reads for support.
 *
 * All through the SSR client. `p_self_read on profiles` grants support every profile and a
 * customer only their own, which is what makes it safe to have no role check in this file:
 * a content manager who guesses the URL gets an empty list, not a leak. The page still checks
 * the capability, because being shown an empty screen is a worse answer than being redirected.
 */

export interface CustomerListRow {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  loyaltyPoints: number;
  ordersCount: number;
  lifetimeCents: number;
  lastOrderAt: string | null;
  activeSubscriptions: number;
  createdAt: string;
  deletedAt: string | null;
}

export const CUSTOMERS_PAGE_SIZE = 30;

interface RawCustomerRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  loyalty_points: number;
  orders_count: number;
  lifetime_cents: number;
  last_order_at: string | null;
  active_subscriptions: number;
  created_at: string;
  deleted_at: string | null;
}

function toRow(raw: RawCustomerRow): CustomerListRow {
  return {
    id: raw.id,
    email: raw.email,
    fullName: raw.full_name,
    phone: raw.phone,
    role: raw.role,
    loyaltyPoints: raw.loyalty_points,
    ordersCount: raw.orders_count,
    lifetimeCents: raw.lifetime_cents,
    lastOrderAt: raw.last_order_at,
    activeSubscriptions: raw.active_subscriptions,
    createdAt: raw.created_at,
    deletedAt: raw.deleted_at,
  };
}

const CUSTOMER_SELECT = `id, email, full_name, phone, role, loyalty_points, orders_count,
  lifetime_cents, last_order_at, active_subscriptions, created_at, deleted_at`;

export async function listCustomers(
  options: { search?: string; page?: number } = {},
): Promise<{ rows: CustomerListRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const page = Math.max(0, options.page ?? 0);
  const start = page * CUSTOMERS_PAGE_SIZE;

  let query = supabase
    .from('v_admin_customers')
    .select(CUSTOMER_SELECT)
    .order('created_at', { ascending: false })
    .range(start, start + CUSTOMERS_PAGE_SIZE);

  if (options.search) {
    const term = `%${options.search}%`;
    query = query.or(`email.ilike.${term},full_name.ilike.${term},phone.ilike.${term}`);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('listCustomers failed', { cause: error.message });
    return { rows: [], hasMore: false };
  }

  const raw = (data ?? []) as RawCustomerRow[];
  const hasMore = raw.length > CUSTOMERS_PAGE_SIZE;
  return { rows: raw.slice(0, CUSTOMERS_PAGE_SIZE).map(toRow), hasMore };
}

export interface CustomerDetail extends CustomerListRow {
  marketingOptIn: boolean;
  addresses: {
    id: string;
    label: string | null;
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    postalCode: string | null;
    countryCode: string;
    phone: string;
    isDefaultShipping: boolean;
  }[];
  orders: {
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    placedAt: string;
  }[];
  subscriptions: {
    id: string;
    status: string;
    frequencyDays: number;
    nextRunAt: string;
  }[];
  ledger: {
    id: string;
    points: number;
    reason: string;
    note: string | null;
    createdAt: string;
  }[];
}

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const supabase = await createClient();

  const { data: summary, error } = await supabase
    .from('v_admin_customers')
    .select(`${CUSTOMER_SELECT}, marketing_opt_in`)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('getCustomer failed', { cause: error.message, id });
    return null;
  }
  if (!summary) return null;

  /*
   * Four reads in parallel rather than a nested select. PostgREST can embed all of them, but
   * the resulting URL is long enough to be unreadable and one bad column name fails the whole
   * response with a null body — the failure mode docs/13 §L2 records from the audit tab.
   */
  const [addresses, orders, subscriptions, ledger] = await Promise.all([
    supabase
      .from('addresses')
      .select(
        'id, label, recipient_name, line1, line2, city, postal_code, country_code, phone, is_default_shipping',
      )
      .eq('user_id', id)
      .order('is_default_shipping', { ascending: false }),
    supabase
      .from('orders')
      .select('id, order_number, status, total_cents, placed_at')
      .eq('user_id', id)
      .order('placed_at', { ascending: false })
      .limit(25),
    supabase
      .from('subscriptions')
      .select('id, status, frequency_days, next_run_at')
      .eq('user_id', id)
      .order('next_run_at', { ascending: true }),
    supabase
      .from('loyalty_transactions')
      .select('id, points, reason, note, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const raw = summary as RawCustomerRow & { marketing_opt_in: boolean };

  return {
    ...toRow(raw),
    marketingOptIn: raw.marketing_opt_in,
    addresses: (addresses.data ?? []).map((row) => ({
      id: row.id,
      label: row.label,
      recipientName: row.recipient_name,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      postalCode: row.postal_code,
      countryCode: row.country_code,
      phone: row.phone,
      isDefaultShipping: row.is_default_shipping,
    })),
    orders: (orders.data ?? []).map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      totalCents: row.total_cents,
      placedAt: row.placed_at,
    })),
    subscriptions: (subscriptions.data ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      frequencyDays: row.frequency_days,
      nextRunAt: row.next_run_at,
    })),
    ledger: (ledger.data ?? []).map((row) => ({
      id: row.id,
      points: row.points,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at,
    })),
  };
}

/**
 * docs/06 §9 — the GDPR data export.
 *
 * Everything the shop holds about one person, as it is stored rather than as the panel renders
 * it. Article 15 asks for the personal data, not for a report about it, and a support agent
 * hand-assembling a summary is how a category gets forgotten.
 *
 * Reviews and contact messages are included because both carry free text the customer wrote.
 * `audit_logs` is not: those rows are about staff actions, and the ones referencing this
 * customer would expose which agent looked at their account.
 */
export async function exportCustomer(id: string): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();

  const [profile, addresses, orders, subscriptions, ledger, reviews, messages, wishlist] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('addresses').select('*').eq('user_id', id),
      supabase.from('orders').select('*, order_items ( * ), shipments ( * )').eq('user_id', id),
      supabase.from('subscriptions').select('*, subscription_items ( * )').eq('user_id', id),
      supabase.from('loyalty_transactions').select('*').eq('user_id', id),
      supabase.from('reviews').select('*').eq('user_id', id),
      supabase.from('quiz_submissions').select('*').eq('user_id', id),
      supabase.from('wishlist_items').select('*').eq('user_id', id),
    ]);

  /*
   * docs/15 §2 — a saved protocol is personal data and belongs in the export.
   *
   * `inputs` holds the answers about medication and life stage, which is about as personal as
   * anything this table has. Added when the generator superseded the Finder: `quiz_submissions`
   * stays for the historical rows, but every new one lands here instead.
   */
  const protocols = await supabase
    .from('generated_protocols')
    .select('share_code, config_version, inputs, result, created_at')
    .eq('user_id', id);

  if (!profile.data) return null;

  const email = (profile.data as { email: string }).email;
  const contact = await supabase.from('contact_messages').select('*').eq('email', email);
  const newsletter = await supabase.from('newsletter_subscribers').select('*').eq('email', email);

  return {
    exported_at: new Date().toISOString(),
    profile: profile.data,
    addresses: addresses.data ?? [],
    orders: orders.data ?? [],
    subscriptions: subscriptions.data ?? [],
    loyalty_transactions: ledger.data ?? [],
    reviews: reviews.data ?? [],
    quiz_submissions: messages.data ?? [],
    biohack_protocols: protocols.data ?? [],
    wishlist: wishlist.data ?? [],
    contact_messages: contact.data ?? [],
    newsletter: newsletter.data ?? [],
  };
}
