/**
 * docs/18 §2.1 — what a key may do, and §3.6 — what a webhook may be told.
 *
 * Both lists are mirrored from the CHECK constraints in the migration and from `merchant_api_scope_for`.
 * The SQL is the authority — a key without the scope is refused there whatever this file says — and
 * the integration suite asserts the two agree. This copy exists so the portal can render checkboxes
 * and the request schemas can refuse an unknown scope or event with a field path.
 */

export const API_SCOPES = [
  'catalogue:read',
  'offers:read',
  'offers:write',
  'proposals:read',
  'proposals:write',
  'orders:read',
  'orders:write',
  'webhooks:read',
  'webhooks:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** The scope each action needs; `null` for `me`, which any live key may ask. Mirrors the SQL. */
export const SCOPE_FOR_ACTION = {
  me: null,
  catalogue: 'catalogue:read',
  offers: 'offers:read',
  'offers.upsert': 'offers:write',
  proposals: 'proposals:read',
  'proposals.batch': 'proposals:read',
  'proposals.create': 'proposals:write',
  'proposals.image_slot': 'proposals:write',
  'proposals.attach_image': 'proposals:write',
  fulfilments: 'orders:read',
  fulfilment: 'orders:read',
  'fulfilment.accept': 'orders:write',
  'fulfilment.pack': 'orders:write',
  'fulfilment.ship': 'orders:write',
  'fulfilment.decline': 'orders:write',
  webhooks: 'webhooks:read',
  'webhook.deliveries': 'webhooks:read',
  'webhook.create': 'webhooks:write',
  'webhook.update': 'webhooks:write',
  'webhook.delete': 'webhooks:write',
  'webhook.rotate': 'webhooks:write',
  'webhook.ping': 'webhooks:write',
} as const satisfies Record<string, ApiScope | null>;

export type MerchantApiAction = keyof typeof SCOPE_FOR_ACTION;

export const WEBHOOK_EVENTS = [
  'ping',
  'offer.approved',
  'offer.rejected',
  'offer.review_required',
  'proposal.approved',
  'proposal.rejected',
  'proposal.needs_info',
  'proposal.product_created',
  'batch.decided',
  'fulfilment.assigned',
  'fulfilment.cancelled',
  'fulfilment.delivered',
  'fulfilment.returned',
  'payout.approved',
  'payout.paid',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
