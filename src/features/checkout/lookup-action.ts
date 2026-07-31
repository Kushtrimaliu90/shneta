'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { localizePath } from '@/lib/i18n';
import { limitByIp } from '@/lib/rate-limit';
import { logger, describeError } from '@/lib/logger';
import { ORDER_ACCESS_COOKIE_NAME, ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS } from '@/lib/constants';
import { orderLookupSchema } from '@/features/cart/schemas';
import { getOrderAccessToken } from '@/features/checkout/order-access';

export type LookupErrorKey = 'order.lookup.notFound' | 'order.lookup.throttled';

/**
 * There is no success branch: a match redirects, so the only state this action can ever
 * return to the client is a failure. It carries the submitted values back so the form can
 * repopulate — see `failed()`.
 */
export type LookupState = {
  ok: false;
  error: LookupErrorKey;
  values: { orderNumber: string; email: string };
} | null;

/**
 * Every failure looks identical to the caller, and it hands back what was typed.
 *
 * Repopulating matters more here than on most forms: people arrive at order lookup *because*
 * they are unsure of a 20-character order number, and the common failure is a single wrong
 * character. Clearing both fields on each attempt means retyping the whole thing to fix one
 * digit, which is how a lookup form turns into a support call.
 *
 * Values are truncated before they go back into the DOM — on a schema failure they are
 * arbitrary submitted strings, and the field caps in `orderLookupSchema` have not been
 * applied yet at that point.
 */
function failed(error: LookupErrorKey, orderNumber: unknown, email: unknown): LookupState {
  const clamp = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';

  return {
    ok: false,
    error,
    values: { orderNumber: clamp(orderNumber, 40), email: clamp(email, 254) },
  };
}

/**
 * docs/05 §13 — guest order lookup.
 *
 * On success this **sets the same access cookie the checkout RPC issues and redirects** to a
 * server-rendered order page, rather than returning the order to the client. Three reasons:
 * the read-only summary stays a Server Component and ships no JavaScript; the email never
 * appears in a URL, history or referrer; and the resulting page uses exactly the same
 * authorisation check as the success page, so there is one gate to reason about instead of two.
 *
 * Every failure returns the **same** generic message — number not found, email mismatch, and
 * malformed input are indistinguishable. Order numbers are partly sequential, so anything
 * finer would be an oracle for testing them. Rate-limited on top.
 */
export async function lookupOrder(
  _previous: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const submitted = Object.fromEntries(formData);
  const parsed = orderLookupSchema.safeParse(submitted);

  // Malformed input is answered exactly like a miss — no hint about which field was wrong.
  if (!parsed.success) {
    return failed('order.lookup.notFound', submitted.orderNumber, submitted.email);
  }

  const { orderNumber: wantedNumber, email } = parsed.data;

  if (!(await limitByIp('orderLookup', await headers()))) {
    return failed('order.lookup.throttled', wantedNumber, email);
  }

  let orderNumber: string;

  try {
    const found = await getOrderAccessToken(wantedNumber, email);
    if (!found) {
      logger.info('Order lookup miss');
      return failed('order.lookup.notFound', wantedNumber, email);
    }

    orderNumber = found.orderNumber;

    const store = await cookies();
    store.set(ORDER_ACCESS_COOKIE_NAME, `${found.orderNumber}:${found.accessToken}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: ORDER_ACCESS_COOKIE_MAX_AGE_SECONDS,
    });
  } catch (error) {
    logger.error('lookupOrder threw', describeError(error));
    return failed('order.lookup.notFound', wantedNumber, email);
  }

  // Outside the try: redirect() signals by throwing and must not be caught.
  redirect(localizePath(`/order-lookup/${orderNumber}`, await getLocale()));
}
