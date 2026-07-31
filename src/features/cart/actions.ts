'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { CART_COOKIE_NAME, CART_COOKIE_MAX_AGE_SECONDS, MAX_CART_ITEM_QTY } from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import { findActiveCart } from '@/features/cart/queries';
import { addToCartSchema, removeLineSchema, updateQuantitySchema } from '@/features/cart/schemas';
import type { CartErrorKey } from '@/features/cart/types';

/**
 * Cart mutations (docs/07 §3).
 *
 * Stock is deliberately **not reserved** by carting — only checkout decrements it (docs/07
 * §3.2). Add-to-cart still validates current availability, so the common case fails early
 * with a clear message instead of at the payment step.
 */
export type CartResult = ActionResult<{ itemCount: number }, CartErrorKey>;

const cartFail = (error: CartErrorKey): CartResult =>
  fail<CartErrorKey, { itemCount: number }>(error);

/**
 * Resolves the caller's active cart, creating one if needed.
 *
 * Unlike `findActiveCart`, this may write: for a guest it mints an `anon_token` and sets the
 * cookie, so it can only be called from an action or route handler.
 */
async function ensureCart(): Promise<{ id: string; client: SupabaseClient }> {
  const existing = await findActiveCart();
  if (existing) return { id: existing.row.id, client: existing.client };

  const user = await getCurrentUser();

  if (user) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('carts')
      .insert({ user_id: user.id })
      .select('id')
      .single();
    if (error || !data) throw new Error(`cart create failed: ${error?.message}`);
    return { id: data.id, client: supabase };
  }

  // Guest: service client, because no policy can match a cart with user_id null.
  const admin = createAdminClient();
  const { data, error } = await admin.from('carts').insert({}).select('id, anon_token').single();
  if (error || !data) throw new Error(`guest cart create failed: ${error?.message}`);

  const row = data as { id: string; anon_token: string };
  const store = await cookies();
  store.set(CART_COOKIE_NAME, row.anon_token, {
    // docs/07 §3.1 — httpOnly so no script can read the token, SameSite=Lax so it survives
    // a normal navigation back from an external payment page.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });

  return { id: row.id, client: admin };
}

async function countItems(client: SupabaseClient, cartId: string): Promise<number> {
  const { data } = await client.from('cart_items').select('quantity').eq('cart_id', cartId);
  return ((data ?? []) as { quantity: number }[]).reduce((sum, row) => sum + row.quantity, 0);
}

/** Cart totals appear in the navbar on every page, so the whole tree is revalidated. */
function revalidateCart(): void {
  revalidatePath('/', 'layout');
}

export async function addToCart(formData: FormData): Promise<CartResult> {
  const parsed = addToCartSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return cartFail('cart.errors.generic');

  try {
    const { variantId, quantity } = parsed.data;
    const { id: cartId, client } = await ensureCart();

    // Validate against the live catalog before touching the cart, so an unpurchasable
    // variant never lands in it (docs/07 §3.2).
    const { data: variant } = await client
      .from('product_variants')
      .select('id, is_active, products ( status, deleted_at )')
      .eq('id', variantId)
      .maybeSingle();

    const record = variant as {
      id: string;
      is_active: boolean;
      products: { status: string; deleted_at: string | null } | null;
    } | null;

    if (
      !record?.is_active ||
      record.products?.status !== 'published' ||
      record.products.deleted_at !== null
    ) {
      return cartFail('cart.errors.variantUnavailable');
    }

    const { data: stock } = await client
      .from('v_product_stock')
      .select('is_available')
      .eq('variant_id', variantId)
      .maybeSingle();

    if ((stock as { is_available: boolean } | null)?.is_available !== true) {
      return cartFail('cart.errors.outOfStock');
    }

    // docs/07 §3.2 — adding an existing variant increments rather than duplicating.
    const { data: existing } = await client
      .from('cart_items')
      .select('id, quantity')
      .eq('cart_id', cartId)
      .eq('variant_id', variantId)
      .maybeSingle();

    const current = (existing as { id: string; quantity: number } | null)?.quantity ?? 0;
    const next = Math.min(current + quantity, MAX_CART_ITEM_QTY);

    if (current >= MAX_CART_ITEM_QTY) return cartFail('cart.errors.maxQuantity');

    const { error } = existing
      ? await client
          .from('cart_items')
          .update({ quantity: next })
          .eq('id', (existing as { id: string }).id)
      : await client
          .from('cart_items')
          .insert({ cart_id: cartId, variant_id: variantId, quantity: next });

    if (error) {
      logger.error('addToCart failed', { cause: error.message });
      return cartFail('cart.errors.generic');
    }

    const itemCount = await countItems(client, cartId);
    revalidateCart();
    return ok({ itemCount });
  } catch (error) {
    logger.error('addToCart threw', describeError(error));
    return cartFail('cart.errors.generic');
  }
}

export async function updateCartQuantity(formData: FormData): Promise<CartResult> {
  const parsed = updateQuantitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return cartFail('cart.errors.generic');

  try {
    const found = await findActiveCart();
    if (!found) return cartFail('cart.errors.notFound');

    const { lineId, quantity } = parsed.data;

    // Zero means remove — a stepper decremented to 0 should delete the line, not error.
    const { error } =
      quantity === 0
        ? await found.client
            .from('cart_items')
            .delete()
            .eq('id', lineId)
            .eq('cart_id', found.row.id)
        : await found.client
            .from('cart_items')
            .update({ quantity })
            .eq('id', lineId)
            .eq('cart_id', found.row.id);

    if (error) {
      logger.error('updateCartQuantity failed', { cause: error.message });
      return cartFail('cart.errors.generic');
    }

    const itemCount = await countItems(found.client, found.row.id);
    revalidateCart();
    return ok({ itemCount });
  } catch (error) {
    logger.error('updateCartQuantity threw', describeError(error));
    return cartFail('cart.errors.generic');
  }
}

export async function removeCartLine(formData: FormData): Promise<CartResult> {
  const parsed = removeLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return cartFail('cart.errors.generic');

  try {
    const found = await findActiveCart();
    if (!found) return cartFail('cart.errors.notFound');

    // Scoped by cart_id as well as line id: for a guest the service client bypasses RLS, so
    // this is what stops a forged line id from deleting out of someone else's cart.
    const { error } = await found.client
      .from('cart_items')
      .delete()
      .eq('id', parsed.data.lineId)
      .eq('cart_id', found.row.id);

    if (error) return cartFail('cart.errors.generic');

    const itemCount = await countItems(found.client, found.row.id);
    revalidateCart();
    return ok({ itemCount });
  } catch (error) {
    logger.error('removeCartLine threw', describeError(error));
    return cartFail('cart.errors.generic');
  }
}

/**
 * Void-returning wrappers for plain `<form action={…}>` usage.
 *
 * React requires a form action to return `void`, and `useActionState` would be the wrong
 * tool for the quantity stepper: each button is its own single-field form, so threading
 * state through would mean three separate state hooks per line.
 *
 * Discarding the result is safe here because `revalidatePath` re-renders the cart from the
 * database straight afterwards — the user always sees the true state, and a failed
 * increment simply leaves the quantity where it was. Failures are logged inside the actions.
 */
export async function updateCartQuantityForm(formData: FormData): Promise<void> {
  await updateCartQuantity(formData);
}

export async function removeCartLineForm(formData: FormData): Promise<void> {
  await removeCartLine(formData);
}

/**
 * docs/07 §3.3 — merge a guest cart into the user's on sign-in.
 *
 * Quantities sum and cap at the per-line maximum, the guest cart is marked `converted`, and
 * the cookie is cleared. **Idempotent**: a second call finds no active guest cart and does
 * nothing, which matters because it runs on every sign-in and every page that notices a
 * stale cookie.
 */
export async function mergeGuestCart(): Promise<ActionResult<{ merged: number }>> {
  try {
    const user = await getCurrentUser();
    if (!user) return ok({ merged: 0 });

    const store = await cookies();
    const token = store.get(CART_COOKIE_NAME)?.value;
    if (!token) return ok({ merged: 0 });

    const admin = createAdminClient();

    const { data: guestCart } = await admin
      .from('carts')
      .select('id')
      .eq('anon_token', token)
      .eq('status', 'active')
      .maybeSingle();

    if (!guestCart) {
      // Stale cookie — clear it so this does not run again on every request.
      store.delete(CART_COOKIE_NAME);
      return ok({ merged: 0 });
    }

    const guestCartId = (guestCart as { id: string }).id;

    const { data: guestLines } = await admin
      .from('cart_items')
      .select('variant_id, quantity')
      .eq('cart_id', guestCartId);

    const lines = (guestLines ?? []) as { variant_id: string; quantity: number }[];

    // Find or create the user's cart. Service client throughout: this touches two carts, one
    // of which the user does not own yet.
    const { data: userCart } = await admin
      .from('carts')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    let userCartId = (userCart as { id: string } | null)?.id;

    if (!userCartId) {
      const { data: created, error } = await admin
        .from('carts')
        .insert({ user_id: user.id })
        .select('id')
        .single();
      if (error || !created) throw new Error(`merge target create failed: ${error?.message}`);
      userCartId = created.id;
    }

    let merged = 0;
    for (const line of lines) {
      const { data: existing } = await admin
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', userCartId)
        .eq('variant_id', line.variant_id)
        .maybeSingle();

      const current = (existing as { id: string; quantity: number } | null)?.quantity ?? 0;
      const next = Math.min(current + line.quantity, MAX_CART_ITEM_QTY);

      const { error } = existing
        ? await admin
            .from('cart_items')
            .update({ quantity: next })
            .eq('id', (existing as { id: string }).id)
        : await admin
            .from('cart_items')
            .insert({ cart_id: userCartId, variant_id: line.variant_id, quantity: next });

      if (!error) merged += 1;
    }

    await admin.from('carts').update({ status: 'converted' }).eq('id', guestCartId);
    store.delete(CART_COOKIE_NAME);

    revalidateCart();
    logger.info('Merged guest cart on sign-in', { lines: merged });
    return ok({ merged });
  } catch (error) {
    // A failed merge must never block sign-in — the user keeps their account cart.
    logger.error('mergeGuestCart threw', describeError(error));
    return ok({ merged: 0 });
  }
}
