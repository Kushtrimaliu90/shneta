/**
 * docs/12 M8 — analytics events, behind consent.
 *
 * There is no provider configured, and this file is deliberately not a stub that pretends
 * otherwise. What it is: the single place a provider will be initialised, and the single
 * function the rest of the app calls to record an event — so that when one is chosen, it is
 * wired in one file rather than sprinkled through components.
 *
 * The rule this exists to keep: **nothing here runs before `CookieConsent` says yes.** The
 * module is dynamically imported by that component and by nothing else, which means a visitor
 * who declines does not download it, let alone execute it. An analytics module imported at the
 * top of a layout has already run by the time a banner renders, whatever the banner then does.
 *
 * `NEXT_PUBLIC_ANALYTICS_ID` is not in `env.client.ts` and not required: absent, every function
 * here is a no-op, which is the correct behaviour for a shop that has not chosen a provider.
 */

let started = false;

/** Called once, after consent. Idempotent — a second call is ignored. */
export function initAnalytics(): void {
  if (started) return;
  started = true;

  const id = process.env.NEXT_PUBLIC_ANALYTICS_ID;
  if (!id) return;

  /*
   * Where a provider's script tag would be injected. Left unwritten rather than guessed:
   * the choice between Plausible, Umami and GA4 changes the snippet, the event API and the
   * privacy notice, and docs/10 does not make it. Whatever lands here inherits the guarantee
   * that it only runs after consent, which is the part worth building first.
   */
}

/**
 * Records one event, if analytics is running.
 *
 * Named events rather than free strings would be better, and will be once there is a provider
 * to receive them; for now the signature is the contract and the body is honest about doing
 * nothing.
 */
export function trackEvent(_name: string, _properties?: Record<string, unknown>): void {
  if (!started) return;
  const id = process.env.NEXT_PUBLIC_ANALYTICS_ID;
  if (!id) return;
}
