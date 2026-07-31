'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { localizePath } from '@/lib/i18n';
import { limitByIp } from '@/lib/rate-limit';
import { logger, describeError } from '@/lib/logger';
import { fail, fromFieldErrors, ok, type ActionResult } from '@/lib/result';
import {
  CART_COOKIE_NAME,
  ORDER_ACCESS_COOKIE_NAME,
  ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/constants';
import { getCurrentUser } from '@/features/auth/queries';
import { findActiveCart } from '@/features/cart/queries';
import { placeOrderSchema } from '@/features/cart/schemas';
import { mapCheckoutError, type CheckoutErrorKey } from '@/features/cart/types';
import { sendOrderConfirmation } from '@/features/checkout/email';

/**
 * docs/07 §4 — the checkout flow.
 *
 * The action is thin on purpose. It validates, resolves the cart, and hands everything to
 * `checkout_create_order`, which is the **single write path for orders** (docs/03 §8). All
 * pricing, stock and coupon logic lives in that transaction — nothing here can be tampered
 * with by a forged payload, because nothing here decides a price.
 */
export type CheckoutState =
  | { ok: true; data: { orderNumber: string } }
  | { ok: false; error: CheckoutErrorKey; sku?: string; fieldErrors?: Record<string, string[]> }
  | null;

function checkoutFail(error: CheckoutErrorKey, sku?: string): CheckoutState {
  return sku ? { ok: false, error, sku } : { ok: false, error };
}

export async function placeOrder(
  _previous: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const raw = Object.fromEntries(formData);

  // Nested address fields arrive flattened from the form.
  const parsed = placeOrderSchema.safeParse({
    ...raw,
    shipping: {
      recipientName: raw['shipping.recipientName'],
      phone: raw['shipping.phone'],
      line1: raw['shipping.line1'],
      line2: raw['shipping.line2'],
      city: raw['shipping.city'],
      postalCode: raw['shipping.postalCode'],
      countryCode: 'XK',
    },
  });

  if (!parsed.success) {
    const flattened = fromFieldErrors<CheckoutErrorKey>(
      'checkout.errors.checkFields',
      parsed.error.flatten(),
    );
    return flattened.ok
      ? checkoutFail('checkout.errors.checkFields')
      : { ok: false, error: flattened.error, fieldErrors: flattened.fieldErrors };
  }

  // docs/02 §9 — 10 per hour.
  if (!(await limitByIp('checkout', await headers()))) {
    return checkoutFail('checkout.errors.tooManyAttempts');
  }

  let orderNumber: string;
  let redirectTo: string;

  try {
    const found = await findActiveCart();
    if (!found) return checkoutFail('checkout.errors.cartNotFound');

    const input = parsed.data;
    const user = await getCurrentUser();

    /*
     * docs/07 §4.2 — authenticated callers invoke the RPC through their own client so
     * `auth.uid()` matches the cart owner; guests go through the service client, because the
     * RPC's ownership check has no uid to compare against and `execute` is revoked from anon.
     */
    const rpcClient = user ? await createClient() : createAdminClient();

    /**
     * The DB stores addresses as snake_case jsonb (docs/03 §6), so the camelCase form input
     * is mapped once, here, rather than at two call sites that could drift.
     */
    const toJsonAddress = (address: typeof input.shipping) => ({
      recipient_name: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 || null,
      city: address.city,
      postal_code: address.postalCode || null,
      country_code: 'XK',
    });

    const { data, error } = await rpcClient.rpc('checkout_create_order', {
      p_cart_id: found.row.id,
      p_email: input.email,
      p_phone: input.phone,
      p_shipping_address: toJsonAddress(input.shipping),
      /*
       * `null`, not omitted: `p_billing_address` has no default in the RPC signature, so it
       * is a required argument. The RPC does `coalesce(p_billing_address, p_shipping_address)`,
       * which is exactly the "same as shipping" behaviour — and keeping that fallback in the
       * transaction means it holds for any caller, not just this form.
       */
      p_billing_address:
        !input.sameAsBilling && input.billing ? toJsonAddress(input.billing) : null,
      p_shipping_method_id: input.shippingMethodId,
      p_payment_provider: input.paymentProvider,
      p_coupon_code: input.couponCode || undefined,
      p_customer_note: input.customerNote || undefined,
      p_locale: await getLocale(),
    });

    if (error) {
      // docs/07 §4.5 — coded errors become sentences a customer can act on.
      const mapped = mapCheckoutError(error.message);
      logger.info('Checkout rejected', { code: error.message, key: mapped.key });
      return checkoutFail(mapped.key, mapped.sku);
    }

    const result = data as { order_id: string; order_number: string; access_token: string };
    orderNumber = result.order_number;

    const store = await cookies();

    /*
     * docs/13 §B1 — the success page is gated on this token, never on the order number
     * alone. Short-lived and httpOnly: it exists to let the customer see the page they just
     * created, not to be a durable credential.
     */
    store.set(ORDER_ACCESS_COOKIE_NAME, `${orderNumber}:${result.access_token}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS,
    });

    // The RPC marked the cart converted, so the guest token is spent.
    store.delete(CART_COOKIE_NAME);

    // docs/07 §12 — a failed email must never fail the order. Fire and forget, logged.
    await sendOrderConfirmation(result.order_id).catch((cause: unknown) => {
      logger.error('Order confirmation email failed', describeError(cause));
    });

    redirectTo = `/checkout/success/${orderNumber}`;
  } catch (error) {
    logger.error('placeOrder threw', describeError(error));
    return checkoutFail('checkout.errors.generic');
  }

  revalidatePath('/', 'layout');
  // Outside the try: redirect() signals by throwing and must not be caught.
  redirect(localizePath(redirectTo, await getLocale()));
}

/**
 * docs/05 §12 — `previewCoupon` shows the projected discount before the order is placed.
 *
 * Validation still happens for real inside the RPC (docs/07 §9 — coupons cannot be
 * enumerated through a public endpoint). This deliberately reveals nothing a guess could
 * mine: it answers only "valid for this cart" or "not", never why.
 */
export async function previewCoupon(
  _previous: ActionResult<{ code: string }, CheckoutErrorKey> | null,
  formData: FormData,
): Promise<ActionResult<{ code: string }, CheckoutErrorKey>> {
  const code = String(formData.get('code') ?? '').trim();
  if (code.length < 2)
    return fail<CheckoutErrorKey, { code: string }>('checkout.errors.couponInvalid');

  if (!(await limitByIp('checkout', await headers()))) {
    return fail<CheckoutErrorKey, { code: string }>('checkout.errors.tooManyAttempts');
  }

  // Echo it back for the checkout form to carry; the RPC is the authority on whether it
  // actually applies.
  return ok({ code });
}
