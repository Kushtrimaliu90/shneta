/**
 * The browser event that tells the navbar badge the cart changed.
 *
 * A custom DOM event rather than a context provider, because the two ends are far apart: the
 * badge is in the layout's header and the thing that changed the cart is a BuyBox three levels
 * into a page, a quantity stepper on `/cart`, or the finder's "add all". Threading a setter
 * through all of those means every future add-to-cart has to remember to call it — and the one
 * that forgets shows a stale number for the rest of the session.
 *
 * The event is fire-and-forget: the badge refetches rather than trusting a payload, so a caller
 * cannot report the wrong count.
 */
export const CART_CHANGED_EVENT = 'biocode:cart-changed';

/** Safe to call from anywhere on the client, including during SSR (where it does nothing). */
export function notifyCartChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}
