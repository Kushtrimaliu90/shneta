/**
 * docs/16 §10 — the marketplace terms, versioned.
 *
 * The text lives in the `pages` table under `marketplace-terms`, so it is served by the same route,
 * editor and markdown pipeline as the customer legal pages. This module holds the **version**, which
 * is the part the code has to agree about.
 *
 * `merchants.terms_version` records which version a merchant accepted and `terms_accepted_at` when.
 * Bump this constant when the terms change materially and acceptance is re-collected; editing the
 * page text without bumping it would leave every existing merchant recorded as having agreed to
 * something they never saw, which is the one thing a versioned agreement exists to prevent.
 */
export const MARKETPLACE_TERMS_VERSION = '1.0';

/** Where a merchant reads the version they accepted. `sq` is unprefixed (docs/08 §1). */
export function marketplaceTermsPath(locale: string): string {
  return locale === 'sq' ? '/legal/marketplace-terms' : `/${locale}/legal/marketplace-terms`;
}

/**
 * True when this merchant has accepted the version currently in force.
 *
 * A merchant on an older version keeps selling — docs/16 §13 gives 30 days' notice and treats
 * continued selling as acceptance — so this drives a banner in the portal, not a lock. Returning
 * false for a merchant who has never accepted anything is the same as for one on an old version,
 * deliberately: both need to be shown the current terms.
 */
export function hasCurrentTerms(termsVersion: string | null): boolean {
  return termsVersion === MARKETPLACE_TERMS_VERSION;
}
