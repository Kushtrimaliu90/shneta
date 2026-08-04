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
export const MARKETPLACE_TERMS_VERSION = '1.1';

/** Where a merchant reads the version they accepted. `sq` is unprefixed (docs/08 §1). */
export function marketplaceTermsPath(locale: string): string {
  return locale === 'sq' ? '/legal/marketplace-terms' : `/${locale}/legal/marketplace-terms`;
}

/**
 * True when this merchant has accepted the version currently in force.
 *
 * A merchant on an older version keeps selling — docs/16 §13 gives 30 days' notice and treats
 * continued selling as acceptance — so this is a banner, not a lock. Returning false for a merchant
 * who has never accepted anything is the same as for one on an old version, deliberately: both need to
 * be shown the current terms.
 *
 * **Nothing consumes this yet, and that is the open item, not an oversight.** The 1.1 bump (clause 14,
 * image rights) left every merchant onboarded under 1.0 recorded against a version that never mentioned
 * images, and *how* to close that is a business decision: serve the 30-day notice clause 1.1 provides
 * for, or gate the portal on re-acceptance. This predicate is what either one is built on. It is
 * docs/14 §19, under the owner's tasks.
 */
export function hasCurrentTerms(termsVersion: string | null): boolean {
  return termsVersion === MARKETPLACE_TERMS_VERSION;
}
