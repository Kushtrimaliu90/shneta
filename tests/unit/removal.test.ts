import { describe, expect, it } from 'vitest';
import {
  canDeleteLive,
  canRemoveBrand,
  canRemoveCategory,
  canRemovePublished,
  impactLines,
  slugTakenByRemoved,
} from '@/features/catalog/removal';

/**
 * Guards for the removal rules.
 *
 * Each rule here exists because of a specific foreign key, and the tests say which — so a future edit
 * that relaxes one has to argue with the reason rather than just with the assertion.
 */

describe('canRemovePublished', () => {
  it('refuses a live product and points at archiving', () => {
    /*
     * Archiving already exists, already takes a product off the storefront, and is already reversible.
     * Collapsing the two would make the fastest way to pull a live product identical to the click that
     * hides it from the panel — indistinguishable in a hurry.
     */
    const verdict = canRemovePublished('published', 'product');
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toContain('live on the site');
    expect(verdict.instead).toContain('Archive it first');
  });

  it('tells an article to go back to draft, not to archive', () => {
    // Articles have no archived status — `article_status` is draft/published.
    const verdict = canRemovePublished('published', 'article');
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.instead).toContain('draft');
    expect(verdict.instead).not.toContain('Archive');
  });

  it('allows every other status', () => {
    for (const status of ['draft', 'pending_review', 'archived']) {
      expect(canRemovePublished(status, 'product').allowed).toBe(true);
    }
  });
});

describe('canRemoveBrand', () => {
  it('allows a brand nothing uses', () => {
    expect(canRemoveBrand(0).allowed).toBe(true);
  });

  it('refuses a brand a product still points at', () => {
    /*
     * `products.brand_id` is `not null references brands(id)` with no on-delete rule. A hard delete is
     * refused by Postgres; a soft delete is worse, because the product keeps pointing at a row no query
     * returns and renders a blank brand instead of failing visibly.
     */
    const verdict = canRemoveBrand(3);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toContain('3 products');
    expect(verdict.instead).toContain('deactivate');
  });

  it('reads as English at one', () => {
    const verdict = canRemoveBrand(1);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toBe('1 product still uses this brand.');
  });
});

describe('canRemoveCategory', () => {
  it('allows an empty leaf category', () => {
    expect(canRemoveCategory(0, 0).allowed).toBe(true);
  });

  it('refuses a parent, because its children would jump to the top level', () => {
    /*
     * `categories.parent_id` is `on delete set null`, and `getCategoryTree` treats a parentless node as
     * a root — so removing "Vitamins" silently promotes "Vitamin D" into the main navigation. Nothing
     * errors; the menu is just wrong.
     */
    const verdict = canRemoveCategory(2, 0);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toContain('2 sub-categories');
    expect(verdict.instead).toContain('top level');
  });

  it('reports children before products when both would block', () => {
    // Children are the structural problem; naming both at once gives an operator two jobs and no order.
    const verdict = canRemoveCategory(1, 5);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toContain('sub-categor');
    expect(verdict.reason).not.toContain('product');
  });

  it('refuses a category products are still in', () => {
    // `p_read on product_categories` is `using (true)`, so a breadcrumb could name a removed category.
    const verdict = canRemoveCategory(0, 4);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe('4 products are in this category.');
  });

  it('reads as English at one product', () => {
    const verdict = canRemoveCategory(0, 1);
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toBe('1 product is in this category.');
  });
});

describe('impactLines', () => {
  it('says nothing when there is nothing an operator would not guess', () => {
    expect(impactLines({})).toEqual([]);
  });

  it('warns that a merchant is not told automatically', () => {
    // Somebody else's business stops being sellable; that is not a consequence to leave implicit.
    const [line] = impactLines({ offers: 2 });
    expect(line).toContain('2 merchant offers');
    expect(line).toContain('not told automatically');
  });

  it('warns that subscription renewals will fail', () => {
    const [line] = impactLines({ subscriptions: 1 });
    expect(line).toContain('1 active subscription');
    expect(line).toContain('renewals will fail');
  });

  it('lists every consequence that applies', () => {
    expect(impactLines({ offers: 1, subscriptions: 1, reviews: 3 })).toHaveLength(3);
  });
});

describe('slugTakenByRemoved', () => {
  it('explains an error that would otherwise come from an invisible row', () => {
    /*
     * `slug text not null unique` with no partial index, so a removed record keeps its slug. That makes
     * restore collision-proof, at the cost of an admin being refused by a row they cannot see.
     */
    expect(slugTakenByRemoved).toContain('does not free its URL');
    expect(slugTakenByRemoved).toContain('restore it');
  });
});

describe('canDeleteLive', () => {
  it('allows deleting something already taken down', () => {
    expect(canDeleteLive(false, 'page', 'anything').allowed).toBe(true);
  });

  it('refuses what is live and names the step that makes it safe', () => {
    /*
     * The same rule products and articles follow, applied to the four entities with no `deleted_at` to
     * fall back on. Each already has a reversible way of being taken down — a status, an `is_active`, a
     * rejection — and taking that step is what turns an irreversible delete into a confirmable one.
     */
    const verdict = canDeleteLive(true, 'review', 'Reject it first.');
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.reason).toBe('This review is live.');
    expect(verdict.instead).toBe('Reject it first.');
  });

  it('carries the caller noun rather than a generic one', () => {
    const verdict = canDeleteLive(true, 'banner', 'Switch it off.');
    if (verdict.allowed) throw new Error('expected a refusal');
    expect(verdict.reason).toContain('banner');
  });
});
