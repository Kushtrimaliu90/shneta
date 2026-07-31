import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/constants';
import { clientIpFrom } from '@/lib/utils';

/**
 * docs/02 §9 — Postgres-backed limiter (the chosen default; Upstash only if keys are
 * provided, and none are). Wraps the `check_rate_limit` RPC, which buckets on absolute
 * epoch so windows of a day behave like a day (docs/13 §A6).
 */

export type RateLimitAction = keyof typeof RATE_LIMITS;

/**
 * Returns true when the caller is within budget.
 *
 * **Fails open.** If the limiter itself is unavailable, legitimate traffic is allowed
 * through rather than the site going down — a rate limiter is a mitigation, not the
 * security boundary. That boundary is RLS plus the per-action auth checks, and neither
 * depends on this. The failure is logged so it surfaces in monitoring.
 */
export async function limit(action: RateLimitAction, identifier: string): Promise<boolean> {
  const entry = RATE_LIMITS[action];
  const [max, windowSeconds] = entry;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: `${action}:${identifier}`,
      p_max: max,
      p_window: `${windowSeconds} seconds`,
    });

    if (error) {
      logger.warn('Rate limiter unavailable; allowing request', {
        action,
        cause: error.message,
      });
      return true;
    }
    return data === true;
  } catch (error) {
    logger.warn('Rate limiter threw; allowing request', {
      action,
      cause: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/** Convenience for route handlers and server actions: bucket by client IP. */
export async function limitByIp(action: RateLimitAction, headers: Headers): Promise<boolean> {
  return limit(action, clientIpFrom(headers));
}
