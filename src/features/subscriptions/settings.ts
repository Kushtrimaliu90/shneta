import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createPublicClient } from '@/lib/supabase/public';
import { CACHE_TAGS, ISR_REVALIDATE_SECONDS } from '@/lib/constants';

/**
 * docs/07 §8.1 — the subscription discount, from `settings`.
 *
 * The PDP is statically cached, so this uses the anonymous client and the Data Cache like every
 * other catalogue read (docs/13 §M1 — a `cookies()` call here would make every product page
 * dynamic). Tagged `settings`, so changing the rate purges it rather than waiting out the window.
 *
 * Zero means "no subscriptions", and the toggle disappears rather than offering 0% off. That is
 * the off switch: a shop that is not ready to promise repeat deliveries sets the row to 0 and
 * the PDP stops advertising them, with no deploy.
 */
export const getSubscriptionDiscountPct = cache(() =>
  unstable_cache(
    async (): Promise<number> => {
      const supabase = createPublicClient();
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'subscriptions')
        .maybeSingle();

      const value = (data as { value: Record<string, unknown> } | null)?.value ?? {};
      const pct = value.discount_pct;

      // Absent row → the docs/07 §8.1 default of 10%, so the feature works before anyone
      // configures it. An explicit 0 is honoured and switches it off.
      if (pct === undefined) return 10;
      return typeof pct === 'number' && pct >= 0 && pct <= 50 ? pct : 10;
    },
    ['subscription-discount'],
    { tags: [CACHE_TAGS.settings], revalidate: ISR_REVALIDATE_SECONDS },
  )(),
);
