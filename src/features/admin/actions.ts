'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign-out for the admin tree.
 *
 * Separate from `features/auth/actions.ts#signOut` because that one ends in
 * `localizedRedirect`, which resolves the active locale through next-intl. The admin tree sits
 * outside `[locale]` and has no request locale (docs/01 §3 — English only), so the locale
 * lookup there is meaningless at best.
 *
 * Lands on the English sign-in page, matching what the admin middleware does when it finds no
 * session. One destination for "you are not signed in to the admin panel", however you got
 * there.
 */
export async function adminSignOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // The storefront layout renders the signed-in state too, so its cache has to go as well.
  revalidatePath('/', 'layout');
  redirect('/en/auth/sign-in');
}

/**
 * The order-flow signals the alerts poller watches (owner, 2026-09-01): orders awaiting
 * confirmation, fulfilments awaiting routing, and merchant-shipped fulfilments whose order has
 * not been marked shipped yet — the one that gates the customer's dispatch email. Reads go
 * through the caller's session, so RLS answers zeros to anyone who is not staff.
 */
export async function loadOrderSignals(): Promise<{
  pendingOrders: number;
  unassigned: number;
  shippedInFlight: number;
}> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('v_admin_pending')
    .select('orders_to_confirm, unassigned_fulfilments')
    .maybeSingle();
  const row = data as { orders_to_confirm: number; unassigned_fulfilments: number } | null;

  const { count } = await supabase
    .from('order_fulfilments')
    .select('id, orders!inner(status)', { count: 'exact', head: true })
    .eq('status', 'shipped')
    .not('orders.status', 'in', '(shipped,delivered,cancelled)');

  return {
    pendingOrders: row?.orders_to_confirm ?? 0,
    unassigned: row?.unassigned_fulfilments ?? 0,
    shippedInFlight: count ?? 0,
  };
}
