import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { EMPTY_PENDING, type PendingRow } from '@/features/admin/pending-queues';

/**
 * Reading the queue counts. The mapping, pluralising and filtering live in `pending-queues.ts`.
 *
 * Split on the `server-only` line: this module reaches for cookies through the SSR Supabase client and
 * must never reach a client bundle, while everything derived from the numbers is a pure function and
 * belongs somewhere a unit test can import it.
 */

/**
 * One round trip for all eleven counts.
 *
 * The admin layout renders on every navigation, so this is one of the hottest queries in the panel —
 * eleven separate `head: true` counts would be eleven round trips per page view. `v_admin_pending`
 * returns them as one row, backed by partial indexes on each queue predicate (migration
 * 20260812000100), so each count is an index-only scan over just the rows in that queue.
 *
 * `maybeSingle` rather than `single`: the view always produces exactly one row, but a role whose grants
 * have been revoked gets a permission error instead, and a badge is not worth turning a page into an
 * error boundary. On failure this logs and returns zeros, so the panel renders exactly as it did before
 * this feature existed — the badges vanish, nothing breaks.
 */
export async function getPendingCounts(): Promise<PendingRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('v_admin_pending').select('*').maybeSingle();

  if (error) {
    logger.error('getPendingCounts failed', { cause: error.message });
    return EMPTY_PENDING;
  }

  return (data as PendingRow | null) ?? EMPTY_PENDING;
}
