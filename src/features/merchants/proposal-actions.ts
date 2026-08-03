'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logger, describeError } from '@/lib/logger';
import { fail, ok, type ActionResult } from '@/lib/result';
import { audit, requireCapability } from '@/features/admin/audit';
import { getMyMerchant } from '@/features/merchants/queries';
import { sendProposalDecided } from '@/features/merchants/email';
import type { Json } from '@/lib/supabase/database.types';

/**
 * docs/16 §4 — a merchant asking for a product BioCode does not list.
 *
 * ── Why this exists at all ──
 *
 * Merchants never create products (§1): one canonical page per product is what makes "who else has this
 * in stock?" a computable question. But a merchant holding stock of something BioCode has never listed
 * has nowhere to put it, and the honest answer to that is a request, not a listing.
 *
 * So a proposal is **an argument, not a draft product**. It carries what the merchant knows — name,
 * brand, form, barcode, a link to the manufacturer — and BioCode creates the canonical product if it
 * agrees. Nothing here writes to `products`, and nothing should: a proposal that could become a product
 * without a human deciding is merchant-created listings with extra steps.
 */

export type ProposalErrorKey =
  | 'merchant.proposals.errors.generic'
  | 'merchant.proposals.errors.invalid'
  | 'merchant.proposals.errors.notMerchant'
  | 'merchant.proposals.errors.tooMany'
  | 'admin.errors.forbidden';

export type ProposalState = ActionResult<{ proposalId?: string }, ProposalErrorKey> | null;

function no(error: ProposalErrorKey): ProposalState {
  return fail<ProposalErrorKey, { proposalId?: string }>(error);
}

const proposalSchema = z.object({
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
  askingPriceEuro: z
    .string()
    .trim()
    .min(1, 'required')
    .transform((value) => Number(value.replace(',', '.')))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= 100_000, 'range')
    .transform((euro) => Math.round(euro * 100)),
  note: z.string().trim().min(10, 'required').max(2000),
});

const decisionSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['approve', 'reject', 'needs_info']),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Submits a proposal.
 *
 * Capped at twenty open proposals per merchant. Not a rate limit on time — a merchant onboarding a real
 * catalogue legitimately submits several in an afternoon — but a cap on how many can be *waiting*, so a
 * merchant cannot make the review queue unusable for everybody else by pasting its whole spreadsheet in.
 */
export async function submitProposal(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const merchant = await getMyMerchant();
  if (!merchant || merchant.status !== 'approved') return no('merchant.proposals.errors.notMerchant');

  const parsed = proposalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.proposals.errors.invalid');
  const input = parsed.data;

  try {
    const supabase = await createClient();

    const { count } = await supabase
      .from('product_proposals')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'needs_info']);

    if ((count ?? 0) >= 20) return no('merchant.proposals.errors.tooMany');

    const { data, error } = await supabase
      .from('product_proposals')
      .insert({
        merchant_id: merchant.id,
        status: 'pending',
        /*
         * One jsonb payload rather than fifteen columns, because the shape of a proposal is a product
         * form BioCode has not designed yet — and a table of nullable columns for fields nobody has
         * agreed on is a migration for every question a reviewer thinks to ask.
         */
        payload: {
          product_name: input.productName,
          brand_name: input.brandName,
          form: input.form || null,
          variant_name: input.variantName || null,
          barcode: input.barcode || null,
          source_url: input.sourceUrl || null,
          stock_on_hand: input.stockOnHand,
          asking_price_cents: input.askingPriceEuro,
          note: input.note,
        } as unknown as Json,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('submitProposal failed', { cause: error.message });
      return no('merchant.proposals.errors.generic');
    }
    if (!data) return no('merchant.proposals.errors.generic');

    revalidatePath('/merchant/proposals');
    revalidatePath('/admin/merchants/proposals');
    return ok({ proposalId: (data as { id: string }).id });
  } catch (error) {
    logger.error('submitProposal threw', describeError(error));
    return no('merchant.proposals.errors.generic');
  }
}

/**
 * Decides a proposal.
 *
 * ── What "approve" does, and deliberately does not do ──
 *
 * It records the decision. It does **not** create the product: that is a catalogue job with a slug, SEO
 * copy, ingredients, images and a compliance review, and it happens on `/admin/products/new` where all
 * of that exists. Approving here means "yes, we will list this" — and the reviewer note is where the
 * product manager writes what they created, so the merchant can go and make an offer on it.
 *
 * A proposal that quietly minted a product would be merchant-created listings with a delay, which is
 * the thing §1 exists to prevent.
 *
 * `needs_info` is a real status here, unlike on a merchant application: the RLS policy lets a merchant
 * *edit* a proposal in `needs_info` and resubmit it, which is the whole point of asking.
 */
export async function decideProposal(
  _previous: ProposalState,
  formData: FormData,
): Promise<ProposalState> {
  const gate = await requireCapability('offers.review');
  if (!gate.ok) return no('admin.errors.forbidden');

  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return no('merchant.proposals.errors.invalid');
  const input = parsed.data;

  if (input.decision !== 'approve' && (input.note ?? '').trim().length < 5) {
    // A rejection or a request for more, with no words, is one the merchant cannot act on.
    return no('merchant.proposals.errors.invalid');
  }

  try {
    const supabase = await createClient();

    const status =
      input.decision === 'approve'
        ? 'approved'
        : input.decision === 'reject'
          ? 'rejected'
          : 'needs_info';

    const { data, error } = await supabase
      .from('product_proposals')
      .update({
        status,
        reviewer_note: input.note ?? null,
        reviewed_by: gate.actor.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', input.proposalId)
      // Only an open proposal can be decided; a stale tab must not re-decide a closed one.
      .in('status', ['pending', 'needs_info'])
      .select('id, merchant_id, payload')
      .maybeSingle();

    if (error) {
      logger.error('decideProposal failed', { cause: error.message });
      return no('merchant.proposals.errors.generic');
    }
    if (!data) return no('merchant.proposals.errors.invalid');

    await audit(`proposal.${status}`, 'product_proposal', input.proposalId, null, {
      note: input.note ?? null,
      merchant_id: (data as { merchant_id: string }).merchant_id,
    } as unknown as Json);

    /*
     * The product name comes back off the row rather than from the form: the reviewer never typed it,
     * and the email's subject line has to name the thing the merchant proposed.
     */
    const decided = data as { merchant_id: string; payload: Record<string, unknown> | null };
    const proposedName =
      typeof decided.payload?.product_name === 'string' ? decided.payload.product_name : '';

    await sendProposalDecided(
      decided.merchant_id,
      proposedName,
      status,
      input.note ?? null,
    );

    revalidatePath('/admin/merchants/proposals');
    revalidatePath('/merchant/proposals');
    return ok({ proposalId: input.proposalId });
  } catch (error) {
    logger.error('decideProposal threw', describeError(error));
    return no('merchant.proposals.errors.generic');
  }
}
