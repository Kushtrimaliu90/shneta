/**
 * Removing catalogue records, and the rules about when that is allowed.
 *
 * Pure: types, copy and the guard verdicts. No database, so a unit test can cover every rule.
 *
 * ── Remove is not delete, and it is not archive either ──
 *
 * Three states, and the codebase already had two of them:
 *
 *   **active** — visible everywhere.
 *   **archived / inactive** — off the storefront, still in the panel, restorable. This is what
 *     `setProductStatus('archived')` and `toggleTaxonomyActive` already do.
 *   **removed** — `deleted_at` set. Gone from the panel too, and gone from the storefront *at the
 *     database*: the public read policies are `(status = 'published' and deleted_at is null)` for
 *     products and articles, and `(is_active and deleted_at is null)` for brands and categories. So a
 *     removal needs no application code to take effect on the public site, and it cannot be forgotten
 *     in one query and honoured in another.
 *
 * Nothing hard-deletes. The evidence is in the foreign keys: a product has thirteen cascading children,
 * including reviews and **merchant offers**, and two blocking references — `stock_movements` and
 * `subscription_items` reference variants with no on-delete rule at all, so Postgres refuses the delete
 * outright for any product that has ever had stock movement. Twenty-four of seventy would refuse today.
 * A reversible flag is both safer and more reliable than a delete that fails for the products people
 * actually sell.
 *
 * ── The slug stays reserved ──
 *
 * `slug text not null unique`, with no partial index excluding removed rows. So a removed record keeps
 * its slug: restoring can never collide, and a URL cannot be quietly reassigned to a different product.
 * The cost is that recreating something under the old slug is refused by an invisible row, which is why
 * `slugTakenByRemoved` exists below — an error that cannot explain itself is the worst kind.
 */

/** What an operator may do to a record, given the state it is in. */
export type RemovalVerdict =
  | { allowed: true }
  | {
      allowed: false;
      /** Why not, in a sentence an operator can act on. */
      reason: string;
      /** The thing to do instead, when there is one. */
      instead?: string;
    };

/**
 * A published product or article is not removable — archive or unpublish it first.
 *
 * Two mechanisms with distinct jobs is worth more than one that does both: archiving is "take it off
 * sale", and it already exists with a Restore path. Removing is "get it out of my way". Collapsing them
 * would mean the fastest way to pull a live product is the same click as the one that hides it from the
 * panel, and an operator in a hurry cannot tell those apart.
 */
export function canRemovePublished(status: string, noun: string): RemovalVerdict {
  if (status !== 'published') return { allowed: true };
  return {
    allowed: false,
    reason: `This ${noun} is live on the site.`,
    instead:
      noun === 'product'
        ? 'Archive it first — that takes it off the storefront and can be undone. Then it can be removed.'
        : 'Set it back to draft first. Then it can be removed.',
  };
}

/**
 * A brand still used by a product cannot be removed.
 *
 * `products.brand_id` is `not null references brands(id)` with no on-delete rule, so the database would
 * refuse a hard delete — and a *soft* delete would be worse than a refusal: the product would keep
 * pointing at a brand that no query returns, so its page would render a blank brand rather than fail
 * visibly. Deactivating is the honest option and already exists.
 */
export function canRemoveBrand(productCount: number): RemovalVerdict {
  if (productCount === 0) return { allowed: true };
  return {
    allowed: false,
    reason: `${productCount} product${productCount === 1 ? '' : 's'} still ${productCount === 1 ? 'uses' : 'use'} this brand.`,
    instead:
      'Move those products to another brand first, or deactivate the brand — that hides it from the shop without breaking them.',
  };
}

/**
 * A category with children or products cannot be removed.
 *
 * Children first: `categories.parent_id` is `on delete set null`, so removing a parent would silently
 * promote its children to top level — a change to the whole shop's navigation, made as a side effect of
 * a delete nobody thought was a restructure.
 *
 * Then products: `product_categories` cascades on a *hard* delete, but a soft delete leaves those link
 * rows pointing at a removed category, and `p_read on product_categories` is `using (true)` — so a
 * breadcrumb could name a category that no longer exists. Refusing is simpler than reconciling.
 */
export function canRemoveCategory(childCount: number, productCount: number): RemovalVerdict {
  if (childCount > 0) {
    return {
      allowed: false,
      reason: `This category has ${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}.`,
      instead: 'Remove or move those first — otherwise they would jump to the top level.',
    };
  }
  if (productCount > 0) {
    return {
      allowed: false,
      reason: `${productCount} product${productCount === 1 ? ' is' : 's are'} in this category.`,
      instead: 'Move them to another category first, or deactivate this one to hide it from the shop.',
    };
  }
  return { allowed: true };
}

/**
 * What a removal takes with it, so the confirmation can say so before it happens.
 *
 * Only consequences an operator would not guess. A removed product taking its own images along is
 * obvious; a merchant's live offer going unsellable is not, and that is somebody else's business.
 */
export interface RemovalImpact {
  /** Merchant offers that will stop being sellable. */
  offers?: number;
  /** Customers with this in a live subscription. */
  subscriptions?: number;
  /** Reviews that will stop being visible. */
  reviews?: number;
}

export function impactLines(impact: RemovalImpact): string[] {
  const lines: string[] = [];

  if (impact.offers) {
    lines.push(
      `${impact.offers} merchant offer${impact.offers === 1 ? '' : 's'} on this product will stop being sellable. The merchant is not told automatically.`,
    );
  }
  if (impact.subscriptions) {
    lines.push(
      `${impact.subscriptions} active subscription${impact.subscriptions === 1 ? '' : 's'} include${impact.subscriptions === 1 ? 's' : ''} it — those renewals will fail until it comes back.`,
    );
  }
  if (impact.reviews) {
    lines.push(`${impact.reviews} review${impact.reviews === 1 ? '' : 's'} will stop being visible.`);
  }

  return lines;
}

/**
 * Deleting outright — for the four entities that have no `deleted_at` to fall back on.
 *
 * ── Why these four are deleted rather than removed ──
 *
 * `pages`, `faqs`, `banners` and `reviews` have no soft-delete column, and adding four of them plus a
 * read filter in every query that touches them is a great deal of machinery for content that is small,
 * cheap to retype, and already hideable. All three of the first group have **zero inbound foreign keys**,
 * so a delete cannot orphan anything.
 *
 * Reviews are the interesting case, and there the hard delete is the *safer* option. The rating trigger
 * fires `after insert or update of status, rating or delete on reviews` and recomputes from
 * `status = 'approved'` — so a DELETE already maintains the product's public rating correctly, while a
 * soft delete would not fire it at all and would leave a removed review still counting toward the stars
 * on a product page. `review_votes` cascades.
 *
 * ── One rule, four times ──
 *
 * **What is live must be taken down before it can be deleted.** A published page, an active FAQ or
 * banner, an approved review. Every one of those already has its own reversible control for that — a
 * status, an `is_active`, a rejection — and each is the step that makes the deletion safe to confirm.
 * It is the same rule products and articles follow, which is why it reads as a rule rather than as four
 * separate opinions.
 */
export function canDeleteLive(
  isLive: boolean,
  noun: string,
  instead: string,
): RemovalVerdict {
  if (!isLive) return { allowed: true };
  return { allowed: false, reason: `This ${noun} is live.`, instead };
}

/** The sentence for a slug held by something an operator cannot see. */
export const slugTakenByRemoved =
  'A removed record still holds that slug. Removing something does not free its URL — restore it, or choose a different slug.';
