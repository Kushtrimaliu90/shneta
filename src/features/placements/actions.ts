'use server';

import { createPublicClient } from '@/lib/supabase/public';

/**
 * The two counters, as server actions.
 *
 * ── Nothing identifying, by construction ──
 *
 * Both take a placement id and nothing else. No visitor id, no address, no session, no referrer, and
 * the RPCs behind them increment a **daily** row rather than inserting an event — so the database
 * holds counts and never a record of who saw what. That is what keeps this outside consent-banner
 * scope: there is nothing to consent to, nothing to export on a subject-access request, and nothing
 * to erase.
 *
 * ── Silent on failure, deliberately ──
 *
 * Neither returns anything and neither throws. An advertising counter must never be able to surface
 * an error on a page a shopper is reading, and a lost impression is the correct thing to lose. The
 * RPCs swallow their own exceptions too, so a constraint problem cannot bubble up through PostgREST.
 */

export async function recordAdImpression(placementId: string): Promise<void> {
  try {
    const supabase = createPublicClient();
    await supabase.rpc('record_ad_impression', { p_placement_id: placementId });
  } catch {
    // See above.
  }
}

export async function recordAdClick(placementId: string): Promise<void> {
  try {
    const supabase = createPublicClient();
    await supabase.rpc('record_ad_click', { p_placement_id: placementId });
  } catch {
    // See above.
  }
}
