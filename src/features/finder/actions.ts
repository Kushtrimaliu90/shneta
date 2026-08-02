'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';
import { limitByIp } from '@/lib/rate-limit';
import { addToCart } from '@/features/cart/actions';
import { readAnswers } from '@/features/finder/answers';
import { getFinderCandidates } from '@/features/finder/queries';
import { buildRoutine } from '@/features/finder/scoring';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/05 §10 — saving a routine, and adding it all to the cart.
 *
 * `quiz_submissions` accepts a null `user_id` (`p_own_insert` allows it), so a guest's answers
 * are recorded too. That is the point of the table: the most useful thing it can tell the shop is
 * what people who did *not* buy were looking for.
 */

export type FinderErrorKey =
  | 'finder.errors.generic'
  | 'finder.errors.tooMany'
  | 'finder.errors.nothingToAdd'
  | 'finder.errors.someUnavailable';

export type FinderState = ActionResult<{ added?: number }, FinderErrorKey> | null;

const saveSchema = z.object({
  answers: z.string().max(4000),
  productIds: z.string().max(2000),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => UUID.test(id)),
    ),
  ];
}

/**
 * Records the submission.
 *
 * Never fails the page. A quiz result the customer can see is worth more than an analytics row,
 * so a write failure is logged and swallowed — the same reasoning as
 * `createSubscriptionsFromCart` not being allowed to fail a checkout.
 */
export async function saveSubmission(
  _previous: FinderState,
  formData: FormData,
): Promise<FinderState> {
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<FinderErrorKey, { added?: number }>('finder.errors.generic');

  /*
   * `quiz_submissions` accepts a null `user_id`, which is what makes guest answers useful — and
   * also what makes this an unauthenticated write endpoint. `finderSubmit` was declared in
   * `RATE_LIMITS` when the table was designed and then never applied to anything; M11's security
   * pass is what noticed. A limit nobody calls is a limit that does not exist.
   */
  if (!(await limitByIp('finderSubmit', await headers()))) {
    return fail<FinderErrorKey, { added?: number }>('finder.errors.tooMany');
  }

  try {
    const user = await getCurrentUser();
    const supabase = await createClient();

    let answers: unknown;
    try {
      answers = JSON.parse(parsed.data.answers);
    } catch {
      answers = { raw: parsed.data.answers };
    }

    const payload =
      parsed.data.email && !user
        ? { ...(answers as Record<string, unknown>), email: parsed.data.email }
        : answers;

    const { error } = await supabase.from('quiz_submissions').insert({
      user_id: user?.id ?? null,
      answers: payload as Json,
      recommended_product_ids: parseIds(parsed.data.productIds),
    });

    if (error) {
      logger.error('saveSubmission failed', { cause: error.message });
      return fail<FinderErrorKey, { added?: number }>('finder.errors.generic');
    }

    return ok({});
  } catch (error) {
    logger.error('saveSubmission threw', describeError(error));
    return fail<FinderErrorKey, { added?: number }>('finder.errors.generic');
  }
}

const addAllSchema = z.object({ variantIds: z.string().max(2000) });

/**
 * docs/05 §10 — "add all to cart".
 *
 * Delegates to `addToCart` per line rather than writing `cart_items` directly, so the routine
 * goes through the same stock check, the same guest-cart cookie handling and the same quantity
 * cap as any other add. A second path into the cart is a second place for the cart to be wrong.
 *
 * Partial success is reported as success with a warning rather than rolled back: a customer who
 * asked for five products and can have four wants the four.
 */
export async function addRoutineToCart(
  _previous: FinderState,
  formData: FormData,
): Promise<FinderState> {
  const parsed = addAllSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<FinderErrorKey, { added?: number }>('finder.errors.generic');

  const variantIds = parseIds(parsed.data.variantIds);
  if (variantIds.length === 0) {
    return fail<FinderErrorKey, { added?: number }>('finder.errors.nothingToAdd');
  }

  let added = 0;

  for (const variantId of variantIds) {
    const lineForm = new FormData();
    lineForm.set('variantId', variantId);
    lineForm.set('quantity', '1');

    const result = await addToCart(lineForm);
    if (result.ok) added += 1;
  }

  if (added === 0) return fail<FinderErrorKey, { added?: number }>('finder.errors.nothingToAdd');
  if (added < variantIds.length) {
    return fail<FinderErrorKey, { added?: number }>('finder.errors.someUnavailable');
  }

  return ok({ added });
}

/**
 * Step 5 → results.
 *
 * A server action rather than another GET step, for one reason: the email must not travel in a
 * query string. A URL ends up in browser history, in the `Referer` header of every outbound link
 * on the results page, and in any access log the request passes through — none of which is an
 * acceptable home for an address somebody gave us to receive one email.
 *
 * So the answers arrive as hidden fields, the email as a POST body, the submission is recorded
 * here, and the redirect carries only the answers.
 */
export async function submitFinder(formData: FormData): Promise<never> {
  const email = String(formData.get('email') ?? '').trim();
  const basePath = String(formData.get('basePath') ?? '/finder');

  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (key === 'email' || key === 'basePath') continue;
    if (typeof value === 'string' && value) params.append(key, value);
  }

  const answers = readAnswers(Object.fromEntries(params.entries()));

  /*
   * Same endpoint, same exposure as `saveSubmission` — an unauthenticated write, so it is
   * limited by IP. Checked **outside** the try: `redirect()` works by throwing, and a catch
   * around it would swallow the redirect and log it as a failure.
   *
   * A refused write still shows the routine. The result belongs to the customer; the analytics
   * row is ours to lose.
   */
  const withinBudget = await limitByIp('finderSubmit', await headers());
  if (!withinBudget) logger.info('Finder submission rate limited');

  if (withinBudget)
    try {
      const candidates = await getFinderCandidates();
      const routine = buildRoutine(candidates, answers);

      const user = await getCurrentUser();
      const supabase = await createClient();

      const payload = email && !user ? { ...answers, email } : answers;

      const { error } = await supabase.from('quiz_submissions').insert({
        user_id: user?.id ?? null,
        answers: payload as unknown as Json,
        recommended_product_ids: routine.products.map((product) => product.productId),
      });

      // Logged, never thrown: a failed analytics write must not cost the customer their result.
      if (error) logger.error('finder submission insert failed', { cause: error.message });
    } catch (error) {
      logger.error('finder submission threw', describeError(error));
    }

  params.set('step', '6');
  redirect(`${basePath}?${params.toString()}`);
}
