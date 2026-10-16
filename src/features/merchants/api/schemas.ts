import { z } from 'zod';
import { API_SCOPES, WEBHOOK_EVENTS } from '@/features/merchants/api/scopes';

/**
 * docs/18 §3 — what the merchant API accepts in a request body.
 *
 * The row shapes are the same keys `merchant_bulk_upsert_offers` and `merchant_bulk_create_proposals`
 * read, because the API hands rows to those functions unchanged. The bounds mirror the CHECK
 * constraints on `merchant_offers` and the SQL caps, so a row the database would refuse is refused
 * here with a field path instead of as a skip reason three hundred rows deep.
 *
 * Money is **integer cents** (CLAUDE.md §2). There is deliberately no euro field: a float that is
 * off by a rounding step on a price list of two hundred items is a commercial dispute, not a bug
 * report, and the sheet parser already has to carry the comma-decimal logic for people. Software
 * can count cents.
 *
 * Every object is `.strict()`: an integration that sends `price_cent` must get a 400 naming the key,
 * not a 200 that changed nothing.
 */

const sku = z.string().trim().min(1).max(64);

export const offerRowSchema = z
  .object({
    /** The merchant's own SKU, or BioCode's SKU or barcode. Matching rules in docs/18 §3.2. */
    sku,
    stock: z.number().int().min(0).max(1_000_000).optional(),
    price_cents: z.number().int().min(1).max(10_000_000).optional(),
    handling_days: z.number().int().min(0).max(30).optional(),
    low_stock_threshold: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const offersUpsertBodySchema = z
  .object({
    rows: z.array(offerRowSchema).min(1).max(2000),
    /**
     * Off by default, exactly as the portal checkbox is: a nightly stock sync must report a mistyped
     * SKU rather than quietly turn it into a draft offer at a price nobody checked (docs/16 §6.1).
     */
    create: z.boolean().default(false),
  })
  .strict();

export type OffersUpsertBody = z.infer<typeof offersUpsertBodySchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const proposalRowSchema = z
  .object({
    product_name: z.string().trim().min(2).max(160),
    brand_name: z.string().trim().min(2).max(120),
    asking_price_cents: z.number().int().min(1).max(10_000_000),
    stock_on_hand: z.number().int().min(0).max(1_000_000).default(0),
    form: optionalText(80),
    variant_name: optionalText(120),
    barcode: optionalText(32),
    merchant_sku: optionalText(64),
    source_url: z.string().trim().url().max(500).optional(),
    note: optionalText(2000),
  })
  .strict();

export const proposalsCreateBodySchema = z
  .object({
    rows: z.array(proposalRowSchema).min(1).max(200),
    /** The covering note for the reviewer, on the batch rather than per row. */
    note: optionalText(2000),
  })
  .strict();

export type ProposalsCreateBody = z.infer<typeof proposalsCreateBodySchema>;

// ── Fulfilments (docs/18 §3.4) ─────────────────────────────────────────────

export const FULFILMENT_STATUSES = [
  'assigned',
  'accepted',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
] as const;

export const fulfilmentsQuerySchema = z
  .object({
    status: z.enum(FULFILMENT_STATUSES).optional(),
  })
  .strict();

/**
 * Carrier and tracking are required to ship — the same product decision the portal makes: a parcel
 * marked shipped with no way for the customer to find it is a support ticket waiting to happen.
 */
export const fulfilmentShipBodySchema = z
  .object({
    carrier: z.string().trim().min(2).max(80),
    tracking_code: z.string().trim().min(3).max(120),
  })
  .strict();

/** Required: a decline with no reason is one nobody can learn from, and the scorecard reads it. */
export const fulfilmentDeclineBodySchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

// ── Webhooks (docs/18 §3.6) ────────────────────────────────────────────────

const httpsUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => value.startsWith('https://'), 'https only');

const events = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length);

export const webhookCreateBodySchema = z
  .object({
    url: httpsUrl,
    events,
    description: optionalText(200),
  })
  .strict();

export type WebhookCreateBody = z.infer<typeof webhookCreateBodySchema>;

export const webhookUpdateBodySchema = z
  .object({
    url: httpsUrl.optional(),
    events: events.optional(),
    description: optionalText(200),
    /** `disabled` pauses deliveries; `active` resumes them and clears an automatic disable. */
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'nothing to change');

// ── Keys, for the portal and the admin screen (docs/18 §2.1) ───────────────

export const scopesSchema = z.array(z.enum(API_SCOPES)).min(1);
