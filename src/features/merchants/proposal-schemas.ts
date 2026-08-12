import { z } from 'zod';
import { PROPOSAL_BULK_MAX } from '@/features/merchants/decisions';

/**
 * docs/16 §4, §9 — what a merchant states when proposing a product BioCode does not list.
 *
 * Lifted out of `proposal-actions.ts` so it can be unit-tested. That file is a Server Actions module,
 * so importing it from a test pulls in `server-only` and the Supabase server client; the schema is pure
 * and has no business being unreachable because of its neighbours. Same reason
 * `features/search/redirects.ts` exists.
 *
 * ── It now describes an offer as well as a product ──
 *
 * Stock and asking price were always here: a reviewer needs them to judge whether a product is worth
 * listing. Approval mints the merchant's offer as of migration 79, so the three remaining offer terms —
 * handling days, low-stock threshold and the merchant's own SKU — are stated here too rather than
 * re-typed into the offer form afterwards. For a 200-row batch that was 200 forms for a decision the
 * merchant had already made (owner, 2026-08-10).
 *
 * The bounds are deliberately the same as the `merchant_offers` CHECK constraints. A term that could
 * never become an offer is refused here, where the merchant can still fix it, rather than months later
 * inside a cron whose only record is `offer_error`.
 */
export const proposalOfferSchema = z.object({
  productName: z.string().trim().min(2, 'required').max(160),
  brandName: z.string().trim().min(2, 'required').max(120),
  /** Free text: capsules, powder, drops. Not an enum, because a merchant knows forms BioCode does not. */
  form: z.string().trim().max(80).optional().or(z.literal('')),
  variantName: z.string().trim().max(120).optional().or(z.literal('')),
  /** EAN or UPC. Optional, and not validated as a checksum: a supplement box often has neither. */
  barcode: z.string().trim().max(32).optional().or(z.literal('')),
  sourceUrl: z.string().trim().url('invalid').max(500).optional().or(z.literal('')),
  /** What they hold and what they would ask, so a reviewer can judge whether it is worth listing. */
  stockOnHand: z.coerce.number().int().min(0).max(1_000_000),
  /*
   * The rest of the offer, stated once.
   *
   * A proposal already carried stock and an asking price, which are two of the five things an offer
   * needs. Approval now mints the offer (migration 79), so the remaining three are asked here rather
   * than re-typed into the offer form after approval — for a 200-row batch that was 200 forms for a
   * decision the merchant had already made.
   *
   * Bounds mirror `merchant_offers`: handling 0-30 is the CHECK, and the marketplace ceiling is
   * applied again at promotion because the settings row can drop below what was valid at submit.
   */
  lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(3),
  handlingDays: z.coerce.number().int().min(0).max(30).default(1),
  merchantSku: z.string().trim().max(64).optional().or(z.literal('')),
  askingPriceEuro: z
    .string()
    .trim()
    .min(1, 'required')
    .transform((value) => Number(value.replace(',', '.')))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= 100_000, 'range')
    .transform((euro) => Math.round(euro * 100)),
  note: z.string().trim().min(10, 'required').max(2000),
});

/**
 * Several proposals decided in one click.
 *
 * `needs_info` is absent on purpose, matching `decide_proposal_batch`'s own `approve|reject` restriction:
 * that status reopens a proposal for the merchant to edit, and asking twenty merchants one shared
 * question is not asking anything. It stays a per-card decision.
 */
export const proposalBulkDecisionSchema = z.object({
  proposalIds: z.array(z.string().uuid()).min(1).max(PROPOSAL_BULK_MAX),
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});
