import type { CatalogErrorKey } from '@/features/catalog/admin-actions';
import type { MediaErrorKey } from '@/features/catalog/media-actions';
import type { TaxonomyErrorKey } from '@/features/catalog/taxonomy-actions';

/**
 * English strings for the catalogue admin — the same arrangement as `features/admin/copy.ts`.
 *
 * The admin UI has no next-intl provider (docs/01 §3), so actions return dotted identifiers and
 * this turns them into sentences. A `Record` keyed on the union means adding an error key
 * without a message is a compile error.
 *
 * Keyed on all three unions because the Media tab renders errors from `media-actions.ts` and the
 * taxonomy screens render errors from `taxonomy-actions.ts` through the same map — one place an
 * operator's error messages live, rather than one per action file.
 */
export const CATALOG_ERRORS: Record<CatalogErrorKey | MediaErrorKey | TaxonomyErrorKey, string> = {
  'admin.errors.forbidden': 'Your role does not allow that action.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.catalog.errors.checkFields': 'Check the fields marked below.',
  'admin.catalog.errors.notFound': 'That product no longer exists.',
  'admin.catalog.errors.slugTaken': 'Another product already uses that slug.',
  'admin.catalog.errors.slugLocked':
    'The slug is locked once a product is published — changing it would break every existing link.',
  'admin.catalog.errors.skuTaken': 'Another variant already uses that SKU.',
  'admin.catalog.errors.invalidPrice': 'Enter a price like 9.90.',
  'admin.catalog.errors.publishBlocked':
    'This product does not meet the publishing requirements yet — see the checklist above.',
  'admin.catalog.errors.lastVariant':
    'A published product needs at least one active variant. Add another before deactivating this one.',
  'admin.catalog.errors.uploadFailed':
    'The upload did not complete. Check your connection and try again.',
  'admin.catalog.errors.fileTooLarge': 'That image is over 2 MB. Compress it and try again.',
  'admin.catalog.errors.fileType': 'Images must be WebP, JPEG, PNG or AVIF.',
  'admin.catalog.errors.duplicateIngredient':
    'The same ingredient is listed twice. Combine the two rows into one.',
  /*
   * Deliberately not "cannot be removed yet": this key serves both the reversible removal and the
   * permanent delete, and the header would name the wrong action for one of them. The specific reason
   * follows immediately from `fieldErrors._form` and is the informative half — "Still attached: 1 stock
   * movement." — so the header only has to introduce it without contradicting the button just pressed.
   */
  'admin.catalog.errors.removeBlocked': 'Not possible yet:',
  'admin.catalog.errors.notRemovable':
    'Health goals and ingredients cannot be removed — switch them off instead. Nothing is lost either way, and a product that lists one keeps working.',
  'admin.catalog.errors.inUse':
    'Published products still use this. Unpublish or recategorise them first.',
  'admin.catalog.errors.hasChildren':
    'This category still has visible sub-categories. Hiding it would move them to the top level of the menu — hide them first.',
  'admin.catalog.errors.categoryCycle':
    'A category cannot sit inside itself or inside one of its own sub-categories.',
};

/** The `product_form` enum from docs/03 §1. */
export const PRODUCT_FORMS = [
  'capsule',
  'tablet',
  'softgel',
  'powder',
  'liquid',
  'gummy',
  'bar',
  'spray',
  'sachet',
  'other',
] as const;

/** docs/03 §1 — the dietary tag vocabulary the storefront filters on. */
export const DIETARY_TAGS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'sugar_free',
  'lactose_free',
  'halal',
  'non_gmo',
] as const;

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};
