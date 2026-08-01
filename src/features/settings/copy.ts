import type { SettingsErrorKey } from '@/features/settings/actions';

export const SETTINGS_ERRORS: Record<SettingsErrorKey, string> = {
  'admin.errors.forbidden': 'Only an admin can change settings.',
  'admin.errors.generic': 'Something went wrong. Please try again.',
  'admin.settings.errors.checkFields': 'Check the fields marked below.',
  'admin.settings.errors.notFound': 'That record no longer exists.',
  'admin.settings.errors.emailTaken': 'Someone already has an account with that address.',
  'admin.settings.errors.lastAdmin':
    'This is the only admin left. Give someone else the admin role first, or nobody will be able to restore access.',
  'admin.settings.errors.noSubCoupon':
    'There is no active coupon for that subscription discount. Create the matching SUB- code in Coupons first — the renewal engine applies the discount as that coupon, and will refuse to ship without it.',
};

/** Staff roles as a person reads them, with what the role actually opens. */
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  customer: 'No panel access',
  support: 'Orders, customers, messages, subscriptions, reviews, coupons (read)',
  product_manager: 'Products, categories, brands, ingredients, inventory',
  content_manager: 'Articles, pages, FAQs, banners, health goals, reviews',
  warehouse_manager: 'Orders (ship only), inventory, stock movements',
  compliance_manager: 'The compliance queue and product approval',
  admin: 'Everything, including settings and the team',
};
