'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { getCurrentUser } from '@/features/auth/queries';

/**
 * docs/05 §3 / §14 — the wishlist.
 *
 * `wishlist_items` is a two-column join (user_id, product_id) with a composite primary key and
 * one RLS policy, `p_own`, that scopes every operation to `auth.uid()`. So this file is almost
 * nothing: no ownership check in TypeScript, because a user physically cannot read or write
 * another person's row.
 *
 * **Signed-in only, and no guest wishlist.** A cart is worth keeping for a guest because it
 * ends in a sale; a wishlist that evaporates when the cookie does is a promise the shop cannot
 * keep. The heart therefore prompts a sign-in rather than saving to a cookie.
 */

export type WishlistErrorKey = 'wishlist.errors.signedOut' | 'wishlist.errors.generic';

export type WishlistState = ActionResult<{ saved: boolean }, WishlistErrorKey> | null;

const toggleSchema = z.object({
  productId: z.string().uuid(),
  /** What the client believes the current state to be, so the action knows which way to move. */
  saved: z.union([z.literal('true'), z.literal('')]).optional(),
});

export async function toggleWishlist(
  _previous: WishlistState,
  formData: FormData,
): Promise<WishlistState> {
  const user = await getCurrentUser();
  if (!user) return fail<WishlistErrorKey, { saved: boolean }>('wishlist.errors.signedOut');

  const parsed = toggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail<WishlistErrorKey, { saved: boolean }>('wishlist.errors.generic');

  const wasSaved = parsed.data.saved === 'true';

  try {
    const supabase = await createClient();

    const { error } = wasSaved
      ? await supabase
          .from('wishlist_items')
          .delete()
          .eq('product_id', parsed.data.productId)
          .eq('user_id', user.id)
      : await supabase
          .from('wishlist_items')
          .insert({ product_id: parsed.data.productId, user_id: user.id });

    if (error && !error.message.includes('duplicate key')) {
      logger.error('toggleWishlist failed', { cause: error.message });
      return fail<WishlistErrorKey, { saved: boolean }>('wishlist.errors.generic');
    }

    // Only the account page renders from this list; the heart itself is client state.
    revalidatePath('/account/wishlist');
    return ok({ saved: !wasSaved });
  } catch (error) {
    logger.error('toggleWishlist threw', describeError(error));
    return fail<WishlistErrorKey, { saved: boolean }>('wishlist.errors.generic');
  }
}

/**
 * Every product the signed-in visitor has saved.
 *
 * A read in a `'use server'` module, for the same reason as `loadReviewContext`: the pages that
 * render hearts (PLP, PDP, search) are statically cached, so per-viewer state cannot come from
 * the server render.
 *
 * The **whole** list rather than "which of these ids" — one query per page instead of one per
 * card, and the answer is the same for every heart on the page, however many mount and whenever
 * they do. A wishlist is capped at a hundred rows and holds two columns.
 *
 * Returns `[]` for a guest rather than erroring: a logged-out visitor has an empty wishlist,
 * which is a true answer, not a failure.
 */
export async function loadWishlistState(): Promise<{ signedIn: boolean; ids: string[] }> {
  const user = await getCurrentUser();
  if (!user) return { signedIn: false, ids: [] };

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('wishlist_items')
      .select('product_id')
      .eq('user_id', user.id)
      .limit(200);

    return {
      signedIn: true,
      ids: ((data ?? []) as { product_id: string }[]).map((row) => row.product_id),
    };
  } catch (error) {
    logger.error('loadWishlistState threw', describeError(error));
    return { signedIn: true, ids: [] };
  }
}
