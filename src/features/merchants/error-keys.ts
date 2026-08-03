/**
 * Turning a namespaced action error into a key a scoped `t()` will accept.
 *
 * The actions return **full** message keys — `merchant.offers.errors.locked` — so any caller can
 * render one with a bare `t(result.error)` and the compiler proves it exists (docs/02 §7). The portal
 * components are already scoped to `merchant.offers` or `merchant.settings`, so they need the leaf.
 *
 * `error.split('.').pop()` returns `string | undefined`, and next-intl's typed `t()` rightly refuses
 * it: `t(\`errors.\${string}\`)` could name a key that does not exist. Narrowing against a literal
 * union is what makes the template type resolve — so this is not ceremony to satisfy the compiler, it
 * is the check that a missing message becomes a build error rather than a raw key rendered at a
 * merchant.
 *
 * Anything unrecognised falls back to `generic`. `admin.errors.forbidden` reaches these components
 * only through a path that cannot happen — merchant-side actions do not gate on capabilities — and a
 * generic message is a better answer than a crash if one ever does.
 */

const OFFER_KEYS = [
  'generic',
  'invalid',
  'notMerchant',
  'notApproved',
  'duplicate',
  'handlingTooLong',
  'locked',
] as const;

export type OfferErrorLeaf = (typeof OFFER_KEYS)[number];

export function offerErrorLeaf(error: string): OfferErrorLeaf {
  const leaf = error.split('.').pop() ?? 'generic';
  return (OFFER_KEYS as readonly string[]).includes(leaf) ? (leaf as OfferErrorLeaf) : 'generic';
}

const SETTINGS_KEYS = ['generic', 'invalid', 'notMerchant', 'locked'] as const;

export type SettingsErrorLeaf = (typeof SETTINGS_KEYS)[number];

export function settingsErrorLeaf(error: string): SettingsErrorLeaf {
  const leaf = error.split('.').pop() ?? 'generic';
  return (SETTINGS_KEYS as readonly string[]).includes(leaf)
    ? (leaf as SettingsErrorLeaf)
    : 'generic';
}
