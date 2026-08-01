'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';
import { FREQUENCIES } from '@/features/subscriptions/types';

/**
 * docs/07 §8.3 — the customer's controls: skip, pause, resume, change frequency, change
 * quantities, cancel.
 *
 * "All customer-side actions instant, no penalties." So every one of these is a single write
 * with no confirmation step beyond the one the UI asks for, and cancelling takes effect at once.
 *
 * Ownership is not checked here. `p_own on subscriptions` scopes every read and write to
 * `auth.uid()`, so a forged id updates zero rows rather than somebody else's schedule — the
 * check is in the database, where it cannot be forgotten, and these actions only confirm that
 * *something* was updated.
 */

export type SubscriptionErrorKey =
  | 'account.subscriptions.errors.signedOut'
  | 'account.subscriptions.errors.notFound'
  | 'account.subscriptions.errors.generic';

export type SubscriptionState = ActionResult<{ id?: string }, SubscriptionErrorKey> | null;

function subFail(error: SubscriptionErrorKey): SubscriptionState {
  return fail<SubscriptionErrorKey, { id?: string }>(error);
}

const idSchema = z.object({ subscriptionId: z.string().uuid() });

/**
 * The columns these actions are allowed to write.
 *
 * Not `Record<string, unknown>` — the generated types refuse that, and they are right to, for
 * the same reason as the taxonomy writes in docs/13 §L1: a loose record compiles happily with a
 * misspelled column and fails at runtime. Naming the four columns also documents the blast
 * radius of this helper, which is the point of having one.
 */
type SubscriptionPatch = {
  status?: 'active' | 'paused' | 'cancelled';
  paused_until?: string | null;
  frequency_days?: number;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

/** Runs one update against the caller's own subscription, and reports whether it landed. */
async function mutate(
  subscriptionId: string,
  patch: SubscriptionPatch,
): Promise<SubscriptionState> {
  const user = await getCurrentUser();
  if (!user) return subFail('account.subscriptions.errors.signedOut');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('subscriptions')
      .update(patch)
      .eq('id', subscriptionId)
      .select('id');

    if (error) {
      logger.error('Subscription update failed', { cause: error.message });
      return subFail('account.subscriptions.errors.generic');
    }

    /*
     * Zero rows means RLS refused — a subscription that is not this customer's, or one that no
     * longer exists. Both are "not found" from where they are standing, and saying anything more
     * specific would confirm that somebody else's subscription has that id.
     */
    if ((data ?? []).length === 0) return subFail('account.subscriptions.errors.notFound');

    revalidatePath('/account/subscriptions');
    revalidatePath('/account');
    return ok({ id: subscriptionId });
  } catch (error) {
    logger.error('Subscription update threw', describeError(error));
    return subFail('account.subscriptions.errors.generic');
  }
}

/**
 * docs/07 §8.3 — skip the next delivery.
 *
 * `next_run_at += frequency`, computed in SQL rather than here. A date advanced in JavaScript
 * and written back would be computed in the server's timezone against a value read a moment
 * earlier; the RPC-free version of that is a single statement that reads and writes the same
 * row. `skip_subscription_cycle` does exactly that.
 */
export async function skipNextDelivery(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const user = await getCurrentUser();
  if (!user) return subFail('account.subscriptions.errors.signedOut');

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('skip_subscription_cycle', {
      p_subscription_id: parsed.data.subscriptionId,
    });

    if (error) {
      logger.error('skipNextDelivery failed', { cause: error.message });
      return subFail('account.subscriptions.errors.generic');
    }
    if (data !== true) return subFail('account.subscriptions.errors.notFound');

    revalidatePath('/account/subscriptions');
    revalidatePath('/account');
    return ok({ id: parsed.data.subscriptionId });
  } catch (error) {
    logger.error('skipNextDelivery threw', describeError(error));
    return subFail('account.subscriptions.errors.generic');
  }
}

const pauseSchema = idSchema.extend({
  /** Optional: an empty value pauses indefinitely, a date auto-resumes (docs/07 §8.3). */
  resumeOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE')
    .optional()
    .or(z.literal('')),
});

export async function pauseSubscription(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const parsed = pauseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  return mutate(parsed.data.subscriptionId, {
    status: 'paused',
    paused_until: parsed.data.resumeOn ? `${parsed.data.resumeOn}T00:00:00Z` : null,
  });
}

/**
 * Resume, and move the schedule forward if it is in the past.
 *
 * A subscription paused for two months has a `next_run_at` two months behind. Resuming without
 * touching it would make the renewal engine treat it as due *now* and ship immediately — which
 * is not what "resume" means to anyone. `resume_subscription` rolls the date forward by whole
 * cycles until it is in the future, preserving the original cadence.
 */
export async function resumeSubscription(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const user = await getCurrentUser();
  if (!user) return subFail('account.subscriptions.errors.signedOut');

  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('resume_subscription', {
      p_subscription_id: parsed.data.subscriptionId,
    });

    if (error) {
      logger.error('resumeSubscription failed', { cause: error.message });
      return subFail('account.subscriptions.errors.generic');
    }
    if (data !== true) return subFail('account.subscriptions.errors.notFound');

    revalidatePath('/account/subscriptions');
    revalidatePath('/account');
    return ok({ id: parsed.data.subscriptionId });
  } catch (error) {
    logger.error('resumeSubscription threw', describeError(error));
    return subFail('account.subscriptions.errors.generic');
  }
}

const frequencySchema = idSchema.extend({
  frequencyDays: z.coerce.number().refine((value) => (FREQUENCIES as readonly number[]).includes(value)),
});

export async function changeFrequency(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const parsed = frequencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  /*
   * The cadence changes; the next delivery does not move.
   *
   * Recomputing `next_run_at` from the new frequency would either pull a delivery forward or
   * push it back, neither of which the customer asked for. They asked for "and then every N days
   * after that", which is what leaving the date alone gives them.
   */
  return mutate(parsed.data.subscriptionId, { frequency_days: parsed.data.frequencyDays });
}

const cancelSchema = idSchema.extend({
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function cancelSubscription(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  // docs/07 §8.3 — "no penalties", and the reason is optional. Requiring one is a retention
  // dark pattern, and an unanswered dropdown is worse data than an empty field.
  return mutate(parsed.data.subscriptionId, {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancel_reason: parsed.data.reason || null,
  });
}

const quantitySchema = z.object({
  subscriptionId: z.string().uuid(),
  itemId: z.string().uuid(),
  quantity: z.coerce.number().int().min(0).max(20),
});

/**
 * docs/07 §8.3 — change an item's quantity, or remove it at zero.
 *
 * Removing the last item would leave a subscription that generates empty orders forever, so the
 * last one cannot be removed — the customer is pointed at cancel instead, which is what they
 * mean.
 */
export async function updateSubscriptionItem(
  _previous: SubscriptionState,
  formData: FormData,
): Promise<SubscriptionState> {
  const user = await getCurrentUser();
  if (!user) return subFail('account.subscriptions.errors.signedOut');

  const parsed = quantitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return subFail('account.subscriptions.errors.generic');

  try {
    const supabase = await createClient();

    if (parsed.data.quantity === 0) {
      const { count } = await supabase
        .from('subscription_items')
        .select('id', { count: 'exact', head: true })
        .eq('subscription_id', parsed.data.subscriptionId);

      if ((count ?? 0) <= 1) return subFail('account.subscriptions.errors.notFound');

      const { error } = await supabase
        .from('subscription_items')
        .delete()
        .eq('id', parsed.data.itemId)
        .eq('subscription_id', parsed.data.subscriptionId);

      if (error) {
        logger.error('Subscription item delete failed', { cause: error.message });
        return subFail('account.subscriptions.errors.generic');
      }
    } else {
      const { error } = await supabase
        .from('subscription_items')
        .update({ quantity: parsed.data.quantity })
        .eq('id', parsed.data.itemId)
        .eq('subscription_id', parsed.data.subscriptionId);

      if (error) {
        logger.error('Subscription item update failed', { cause: error.message });
        return subFail('account.subscriptions.errors.generic');
      }
    }

    revalidatePath('/account/subscriptions');
    return ok({ id: parsed.data.subscriptionId });
  } catch (error) {
    logger.error('updateSubscriptionItem threw', describeError(error));
    return subFail('account.subscriptions.errors.generic');
  }
}
